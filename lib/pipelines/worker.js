'use strict'

const fs = require('fs');
const u = require('../utils.js');
const Exif = require('../exif.js');
const elasticsearch = require('elasticsearch');
const sharp = require('sharp');
const path = require('path');
const async = require('async');

function epoch(){
  return new Date().getTime();
}

function getArchive(dir){
  return dir.split(path.sep).pop();
}
function toEpochs(object){
  var convert = ['CreateDate','ReleaseDate'];
  convert.forEach(function (value){
    object[value] = new Date(object[value]).getTime();
  });
  return object;
}

function dumpMetadataToDir(dir, body, callback){
  var filename = body.id;
  var json = JSON.stringify(body);
  if (!body.id){
    filename = u.md5(json);
  }



  fs.writeFile(dir, json, callback);

}


function getThumbnailsLocations(thumbs){
  var obj = {};
  for (var key in thumbs){
    var value = thumbs[key];
    var x = {
      name: value.name,
      metadata : value.metadata
    }
    obj[key] = x;
  }
  return obj;
}
function cleanNoneIndexableFields(object, config){
  config = config || {};
  var noIndex = [
    'NativeDigest', 'DocumentID', 'StripByteCounts', 'ReferenceBlackWhite',
    'XMPToolkit', 'ApplicationRecordVersion', 'PageNumber', 'SampleFormat',
    'Directory', 'SourceFile', 'StripOffsets', 'DocumentName', 'JPEGTables',
    'FilePermissions', 'BitsPerSample', 'XMPFileStamps', 'XResolution', 'YResolution', 'ModifyDate',
    'XmpMM', 'Xmp', 'Crs'

  ];
  if (Array.isArray(config.noindex)){
    noIndex = noIndex.concat(config.noindex);
  }

  for (var key in object){
    if (noIndex.indexOf(key) > -1){
      delete object[key];
    }
  }

  return object;

}
function selectConfig(config, namespace){
  return config.servers.filter(function (conf){
    return (conf.name === namespace)
  }).pop();
}

function _roundDown(number){  return Math.floor((number) / 100) * 100; }

var createPipeline = function (globalConfig, namespace, log, client) {

  var _config = selectConfig(globalConfig, namespace);

  var exif = new Exif(_config.exif, log);

  var watermarkMaxSize = false;

  if (_config.watermark){
    watermarkMaxSize = _config.watermark.maxSize || 0.7;
    var originalWatermarkImage = fs.readFileSync(_config.watermark.image);
  }

  function bumbProgress(job, amount){

    amount = amount || 10;
    var pr = job._progress + amount;
    return job.progress(pr);
  }


  // store the watermarks in memory for more speed, Estemated size is 1-3 Mb
  var watermarkCache = {

  };


  function selectWatermarkOwerlayImage(imageSize, callback){
    var max = {
       height : _roundDown(imageSize.height  * watermarkMaxSize),
       width  : _roundDown(imageSize.width   * watermarkMaxSize)
    };
    max.height  = (max.height < max.width)  ? max.height : max.width;
    max.width   = (max.height > max.width)  ? max.width  : max.height;


    var key = [max.height, max.width, _config.watermark.image].join('x');

    if (watermarkCache[key]){
      return callback(null, watermarkCache[key]);
    }


    sharp(originalWatermarkImage)
      .resize(max.height, max.width)
      .max()
      .toFormat('png')
      .quality(100)
      .toBuffer(function (err, buffer, m){
        if(err) return callback(err);

        watermarkCache[key] = buffer;

        callback(null, buffer);
      });

  }

  return {
    fetchFile : function (job, callback){
      bumbProgress(job);
      log.info(`Starting fetching file ${job.data.path}`);
      var start = epoch();

      job.data.filename = "";
      job.data.archive = "";

      if (job.data.file.location === 'filesystem'){
        return fs.readFile(job.data.file.path, function (err, buffer, x){

          if (err) return callback(err);

          // Get the time for exec
          var diff = ( epoch() - start );

          job.data.filename = path.parse(job.data.file.path).name;

          job.data.archive = getArchive(path.parse(job.data.file.path).dir);

          var fileSize = Buffer.byteLength(buffer);

          job.data.originalImage = {
            buffer : buffer,
            time : diff,
            size : fileSize,
          };
          log.info(`Finshed fetching file ${job.data.path} on ${diff} ms`);

          return callback(null, job);
        });
      }
      return callback(null, job);
    },
    readExif : function (job, callback){
      bumbProgress(job);
      log.info(`Starting reading exif on ${job.data.path}`);

      var start = epoch();
      exif.read(job.data.sourceImage.buffer, function (err, res){
        if (err) return callback(err);

        var diff = ( epoch() - start );

        job.data.exif = {
          data : res,
          time : diff
        };

        log.info(`Done reading exif on ${job.data.path} in ${diff} ms`);


        return callback(null, job);
      });
    },
    createWatermark : function (job, callback){
      bumbProgress(job);

      if (!_config.watermark) return callback(null, job);

      log.info(`Starting create watermark for ${job.data.path}`);

      var start = epoch();

      // Select the right watermark for the job.

      var grav = _config.watermark.gravity || 'south';

      var gravity = sharp.gravity[grav];


      selectWatermarkOwerlayImage(job.data.sourceImage.metadata, function (err, watermarkBuffer, metadata){
        if (err) return callback(err);

        sharp(job.data.sourceImage.buffer)
          .overlayWith(watermarkBuffer, { gravity: gravity } )
          .quality(100)
          .jpeg()
          .toBuffer(function (err, buffer){
            if (err) return callback(err);
            var diff = ( epoch() - start );

            job.data.watermark = {
              buffer : buffer,
              time : diff,
              metadata: metadata
            };

            log.info(`Done create watermark for ${job.data.path} in ${diff} ms`);



            return callback(null, job)
          });
      });

    },
    createSource : function (job, callback){
      bumbProgress(job);
      log.info(`Starting create source image for ${job.data.path}`);

      var start = epoch();
      sharp(job.data.originalImage.buffer)
        .resize(_config.source.size.height, _config.source.size.width)
        .max()
        .toFormat(_config.source.format || 'jpeg')
        .quality(_config.source.quality || 100 )
        .withMetadata()
        .toBuffer(function (err, buffer ,metadata){
          if (err) return callback(err);

          var diff = ( epoch() - start );

          job.data.sourceImage = {
            buffer : buffer,
            time : diff,
            metadata : metadata
          };

          log.info(`Done create source image for ${job.data.path} in ${diff} ms`);

          callback(null, job);
        });
    },
    createThumbnails : function (job, callback){
      bumbProgress(job);
      log.info(`Starting create thumbnails for ${job.data.path}`);

      var start = epoch();

      var inputBuffer = (_config.watermark) ? job.data.watermark.buffer : job.data.sourceImage.buffer;

      job.data.thumbnails = u.getThumbnailsName(job.data.filename, _config.thumbnails);
      async.eachOfLimit(job.data.thumbnails, 1, function (value, key, next){

        var size = {};

        if (job.data.sourceImage.metadata.height >= job.data.sourceImage.metadata.width){
          size.height = value.profile.maxsize;
        }else if (job.data.sourceImage.metadata.height <= job.data.sourceImage.metadata.width){
          size.width = value.profile.maxsize;
        }

        var format = (_config.thumbnails.format == 'jpg') ? 'jpeg' : _config.thumbnails.format;

        sharp(inputBuffer)
          .resize(size.height, size.width)
          .max()
          .toFormat(format || 'jpeg')
          .quality(value.profile.quality || 100 )
          .toBuffer(function (err, buffer, metadata){
            if (err) return next(err);
            var diff = ( epoch() - start );

            job.data.thumbnails[key].buffer = buffer;
            job.data.thumbnails[key].time = diff;
            job.data.thumbnails[key].metadata = metadata;


            next();
          });


      }, function (err){
        inputBuffer = null;
        if (err) return callback(err);


        var diff = ( epoch() - start );


        log.info(`Done create thumbnails for ${job.data.path} in ${diff} ms`);

        return callback(null, job);
      });

    },
    indexExif : function (job, callback){
      bumbProgress(job);

      if (!_config.index) return callback(null, job);

      log.info(`Starting indexing ${job.data.path}`);

      var start = epoch();

      var metadata = job.data.exif.data;
      metadata.archive = job.data.archive;
      metadata.archive_id = u.md5(job.data.archive);
      metadata.filename = job.data.filename;
      metadata.indexed_epoch = start;
      metadata._thumbnails = getThumbnailsLocations(job.data.thumbnails);
      metadata.slug = u.slug(job.data.filename);
      metadata.filename_md5 = u.md5(job.data.filename);

      // FIXME: Hack for index shit... need to be unix cannot be null
      if (!metadata.CreateDate){
        metadata.CreateDate = start;
      }
      if (typeof metadata.DateCreated === 'string' ){
        metadata.DateCreated_string = metadata.DateCreated;
        metadata.DateCreated = start;
      }

      metadata = cleanNoneIndexableFields(metadata, _config.exif);
      metadata = toEpochs(metadata);

      var body = {
        index : _config.index.index,
        type : _config.index.type,
        body : metadata,
        id : metadata.slug
      };

      client.index(body, function indexElasticsearch(err, response){
        if (err) {

          // On fail, dump json into textfile in Directory x:
          //
          if (!_config.faildir) return callback(err);

          return dumpMetadataToDir(_config.faildir, body, function (writeErr){
            if (writeErr) return callback(writeErr);

            // We still need to pass an error
            return callback(err);
          });

        }
        var diff = ( epoch() - start );

        job.data.indexTime = diff;

        log.info(`Done indexing ${job.data.path} in ${diff} ms`);

        callback(null, job);
      });
    },
    storeThumbnails : function (job, callback){
      bumbProgress(job);
      var start = epoch();

      log.info(`Starting storing thumbnails for ${job.data.path}`);
      // store thumbnails..
      //
      // TODO: Add support for S3/Swift
      async.eachOfLimit(job.data.thumbnails, 1, function (value, key, next){

        var location = path.join(_config.thumbnails.destination.folder, value.name);


        var locationFolder = path.parse(location).dir;

        u.createDirecotry(locationFolder, function (){
          fs.writeFile(location, value.buffer, next);
        });


      }, function (err){
        if (err) return callback(err);
        var diff = ( epoch() - start );

        log.info(`Done storing thumbnails for ${job.data.path} in ${diff} ms`);

        job.data.storeThumbnailsTime = diff;
        callback(null, job);

      });
    },
    storeSource : function (job, callback){
      bumbProgress(job);

      log.info(`Starting storing source for ${job.data.path}`);

      var start = epoch();

      if (!_config.source.destination) return callback(null, job);

      var ext = (_config.source.format === 'jpeg') ? 'jpg' :  _config.source.format;

      var dstFilename = `${job.data.filename}.${ext}`;

      var dir = path.join(_config.source.destination, job.data.archive);

      var destination = path.join(dir, dstFilename);

      u.createDirecotry(dir, function (err){
        if (err) return callback(err);

        fs.writeFile(destination, job.data.sourceImage.buffer, function (err, res){
          if (err) return callback(err);

          var diff = ( epoch() - start );

          job.data.storeSoruceTime = diff;
          log.info(`Done storing source for ${job.data.path} in ${diff} ms`);

          callback(null, job);
        });
      })

    }
  };

};


module.exports = createPipeline;

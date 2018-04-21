'use strict'

const fs = require('fs');
const u = require('../utils.js');
const Exif = require('../exif.js');


const XMP = require('../xmp.js');

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

  var filePath = path.join(dir, filename);

  fs.writeFile(filePath, json, callback);

}

function stringy(message){
  if (typeof message === 'object'){
    return JSON.stringify(message);
  }

  return message.toString();
}

function getPageCount(string){
  if (!string) return false;

  const reg = new RegExp(/([0-9]{1,99}\/[0-9]{1,99})/);
  // it shall have "/"
  if (! reg.test(string)){
    return false;
  }

  const numb = string.split('/').shift();

  const int = parseInt(numb);

  if (isNaN(int)) return false;


  return int;

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

  //var exif = new Exif(_config.exif, log);

  const xmp = new XMP();

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
        if(err) {
          log.error({ jobID: job.id, file: job.data.path , errorMessage: stringy(err) }, `Error selectWatermarkOwerlayImage` );
          return callback(err);
        }

        watermarkCache[key] = buffer;

        callback(null, buffer);
      });

  }

  return {
    fetchFile : function (job, callback){
      bumbProgress(job);
      log.debug({ jobID: job.id, file: job.data.path  }, `Starting fetching file`);
      var start = epoch();

      job.data.filename = "";
      job.data.archive = "";

      if (job.data.file.location === 'filesystem'){
        return fs.readFile(job.data.file.path, function (err, buffer, x){

          if (err) {
            log.error({ jobID: job.id, file: job.data.path , errorMessage: stringy(err) }, `Error reading file` );
            return callback(err);
          }
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
          log.info({ jobID: job.id, file: job.data.path , time : diff },`Finshed fetching file`);

          return callback(null, job);
        });
      }
      return callback(null, job);
    },
    readExif : function (job, callback){
      bumbProgress(job);
      log.debug({ jobID: job.id, file: job.data.path  },`Starting reading exif`);

      var start = epoch();

      return xmp.read(job.data.sourceImage.buffer).then(function (metadata){
        const res = metadata.pop();

        // here i need to add BLS count

        if (_config.pagecount){
          let key = _config.pagecount.key;
          let pagecount =getPageCount(res[key]);

          if (pagecount){
            res._pagecount = pagecount;
          }
        }

        var diff = ( epoch() - start );

        job.data.exif = {
          data : res,
          time : diff
        };

        log.info({ jobID: job.id, file: job.data.path , time:diff },`Done reading exif`);


        return callback(null, job);
      }).catch(function (err){
        log.error({ jobID: job.id, file: job.data.path , errorMessage: stringy(err) }, `Error reading exif` );
        return callback(err);
      })

    },
    createWatermark : function (job, callback){
      bumbProgress(job);

      if (!_config.watermark) return callback(null, job);

      log.debug({ jobID: job.id, file: job.data.path  },`Starting create watermark`);

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
            if (err) {
              log.error({ jobID: job.id, file: job.data.path , errorMessage: stringy(err) }, `Create watermark` );
              return callback(err);
            }
            var diff = ( epoch() - start );

            job.data.watermark = {
              buffer : buffer,
              time : diff,
              metadata: metadata
            };

            log.info({ jobID: job.id, file: job.data.path , time:diff },`Done creating watermark`);



            return callback(null, job)
          });
      });

    },
    createSource : function (job, callback){
      bumbProgress(job);
      log.debug({ jobID: job.id, file: job.data.path  },`Starting create source watermark`);

      var start = epoch();
      sharp(job.data.originalImage.buffer)
        .resize(_config.source.size.height, _config.source.size.width)
        .max()
        .toFormat(_config.source.format || 'jpeg')
        .quality(_config.source.quality || 100 )
        .withMetadata()
        .toBuffer(function (err, buffer ,metadata){
          if (err){
            log.error({ jobID: job.id, file: job.data.path , errorMessage: stringy(err) }, `Error create source image` );
            return callback(err);
          }

          var diff = ( epoch() - start );

          job.data.sourceImage = {
            buffer : buffer,
            time : diff,
            metadata : metadata
          };

          log.info({ jobID: job.id, file: job.data.path , time:diff },`Done create source image`);

          callback(null, job);
        });
    },
    checkThumbnailsExists : function (job, callback){
      var start = epoch();


      if (_config.thumbnails.force) return callback(null, job);

      log.debug({ jobID: job.id, file: job.data.path  },`Checking if thumbnails already exist`);

      job.data.thumbnails = u.getThumbnailsName(job.data.filename, _config.thumbnails);
      job.data.thumbnailsExists = false;
      var thumnailsThatExist = [];
      async.eachOfLimit(job.data.thumbnails, 4, function (value, key, next){
        var location = path.join(_config.thumbnails.destination.folder, value.name);

        u.exists(location, function (err, stats){

          if (err){
            if (err.code !== 'ENOENT') log.warn({ jobID: job.id, file: job.data.path }, `Error checking file for exists` , err);
          }
          var e = false;
          if (stats){
            e = true;
            thumnailsThatExist.push(location);
          }

          log.debug({ jobID: job.id, file: job.data.path }, `Checking:${location} exists: ${e}`);
          next();
        });
      }, function done(){
        var diff = ( epoch() - start );
        log.info({ jobID: job.id, file: job.data.path , time:diff },`Done checking if thmbnails exists`);

        if (thumnailsThatExist.length > 0) {

          log.debug({ jobID: job.id, file: job.data.path }, `Thumbnails exist`)
          job.data.thumbnailsExists = true;
        }


        return callback(null, job);
      });

    },
    createThumbnails : function (job, callback){
      bumbProgress(job);

      if(job.data.thumbnailsExists && !_config.thumbnails.force)  {
        log.info({ jobID: job.id, file: job.data.path }, `Thumbnails already exist skipping`);
        return callback(null, job);
      }

      log.debug({ jobID: job.id, file: job.data.path }, `Starting create thumbnails for`);

      var start = epoch();

      var inputBuffer = (_config.watermark) ? job.data.watermark.buffer : job.data.sourceImage.buffer;

      job.data.thumbnails = u.getThumbnailsName(job.data.filename, _config.thumbnails);

      job.data.thumbnailsToStore = false;

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
            if (err) {
              log.debug({ jobID: job.id, file: job.data.path , errorMessage: stringy(err) }, `Error create thumbnail ${key}` );
              return next(err);
            }

            var diff = ( epoch() - start );

            log.debug({ jobID: job.id, file: job.data.path , time:diff }, `Done creating thumbnail: ${key}`);
            job.data.thumbnails[key].buffer = buffer;
            job.data.thumbnails[key].time = diff;
            job.data.thumbnails[key].metadata = metadata;

            next();
          });


      }, function (err){
        inputBuffer = null;
        if (err) {
          log.error({ jobID: job.id, file: job.data.path , errorMessage: stringy(err) }, `Error createThumbnails`);
          return callback(err);
        }

        job.data.thumbnailsToStore = true;

        var diff = ( epoch() - start );


        log.info({ jobID: job.id, file: job.data.path , time:diff }, `Done create thumbnails`);

        return callback(null, job);
      });

    },
    indexExif : function (job, callback){
      bumbProgress(job);

      if (!_config.index) {
        log.info({ jobID: job.id, file: job.data.path }, `Not indexing`);
        return callback(null, job);
      }


      log.debug({ jobID: job.id, file: job.data.path }, `Starting indexing`);

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
        metadata.CreateDate = new Date();
      }
      /*if (typeof metadata.DateCreated === 'string' ){
        metadata.DateCreated_string = metadata.DateCreated;
        metadata.DateCreated = start;
      }*/

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
          log.error({ jobID: job.id, file: job.data.path , errorMessage: stringy(err) }, `Error indexing to elasticsearch`);

          // On fail, dump json into textfile in Directory x:
          //
          if (!_config.index.faildir) {
            log.warning({ jobID: job.id, file: job.data.path }, `no dump directory defined`)
            return callback(err);
          }
          log.info({ jobID: job.id, file: job.data.path }, `Dumping metadata into faildir: ${_config.index.faildir}`);
          return dumpMetadataToDir(_config.index.faildir, body, function (writeErr){
            if (writeErr) {
              log.error({ jobID: job.id, file: job.data.path , errorMessage: stringy(writeErr) }, `Error dumping json to directory`);
              return callback(writeErr);
            }

            // We still need to pass an error
            return callback(err);
          });

        }
        var diff = ( epoch() - start );

        job.data.indexTime = diff;

        log.info({ jobID: job.id, file: job.data.path , time:diff }, `Done indexing`);

        callback(null, job);
      });
    },
    storeThumbnails : function (job, callback){
      bumbProgress(job);
      var start = epoch();

      if (!job.data.thumbnailsToStore) return callback(null, job);

      log.debug({ jobID: job.id, file: job.data.path  },`Starting storing thumbnails`);
      // store thumbnails..
      //
      // TODO: Add support for S3/Swift
      async.eachOfLimit(job.data.thumbnails, 1, function (value, key, next){

        var location = path.join(_config.thumbnails.destination.folder, value.name);

        log.debug({ jobID: job.id, file: job.data.path }, `Storing thumbnail to ${location}`);
        var dir = path.parse(location).dir;

        u.createDirecotry(dir, function (err){
          if (err) log.error({ jobID: job.id, file: job.data.path , errorMessage: stringy(err) }, `Error creating directory ${dir}`);
          fs.writeFile(location, value.buffer, next);
        });


      }, function (err){
        if (err) {
          log.error({ jobID: job.id, file: job.data.path , errorMessage: stringy(err) }, `Error storing thumbnails`);
          return callback(err);
        }
        var diff = ( epoch() - start );

        log.info({ jobID: job.id, file: job.data.path , time:diff }, `Done storing thumbnails`);

        job.data.storeThumbnailsTime = diff;
        callback(null, job);

      });
    },
    storeSource : function (job, callback){
      bumbProgress(job);

      log.debug({ jobID: job.id, file: job.data.path  }, `Starting storing source images`);

      var start = epoch();

      if (!_config.source.destination) return callback(null, job);

      var ext = (_config.source.format === 'jpeg') ? 'jpg' :  _config.source.format;

      var dstFilename = `${job.data.filename}.${ext}`;

      var dir = path.join(_config.source.destination, job.data.archive);

      var destination = path.join(dir, dstFilename);

      u.createDirecotry(dir, function (err){
        if (err)  {
          log.error({ jobID: job.id, file: job.data.path , errorMessage: stringy(err) }, `Error creating directory ${dir}`);
          return callback(err);
        }

        fs.writeFile(destination, job.data.sourceImage.buffer, function (err, res){
          if (err) {
            log.error({ jobID: job.id, file: job.data.path , errorMessage: stringy(err) }, `Error writing file to destination ${destination}`);
            return callback(err);
          }

          var diff = ( epoch() - start );

          job.data.storeSoruceTime = diff;
          log.info({ jobID: job.id, file: job.data.path , time:diff }, `Done storing source images`);

          callback(null, job);
        });
      });

    }
  };

};


module.exports = createPipeline;

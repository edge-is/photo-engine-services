

var fs = require('fs');
var u = require('./utils.js');

var Exif = require('./exif.js');

var elasticsearch = require('elasticsearch');

var sharp = require('sharp');

var path = require('path');
var async = require('async');

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


function getConfig(conf, namespace){
  return conf.servers.filter(function (item){
    var name = Object.keys(item).pop();
    return ( namespace === name);
  }).pop();
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

function _roundDown(number){  return Math.floor((number) / 100) * 100; }

var pipeline = function (config, namespace, log, client) {

  var serverConfig = getConfig(config, namespace);

  var _config = serverConfig[namespace];

  var exif = new Exif(_config.exif, log);


  if (_config.watermark){
    var originalWatermarkImage = fs.readFileSync(_config.watermark.image);
  }


  // store the watermarks in memory for more speed, Estemated size is 1-3 Mb
  var watermarkCache = {

  };

  var watermarkMaxSize = _config.watermark.maxSize || 0.7;

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
    fetchFile : function (object, callback){

      var start = epoch();

      object.filename = "";
      object.archive = "";

      if (object.file.location === 'filesystem'){
        return fs.readFile(object.file.path, function (err, buffer, x){

          if (err) return callback(err);

          // Get the time for exec
          var diff = ( epoch() - start );

          object.filename = path.parse(object.file.path).name;

          object.archive = getArchive(path.parse(object.file.path).dir);

          var fileSize = Buffer.byteLength(buffer);

          object.originalImage = {
            buffer : buffer,
            time : diff,
            size : fileSize,
          };

          return callback(null, object);
        });
      }
    },
    readExif : function (object, callback){

      var start = epoch();
      exif.read(object.sourceImage.buffer, function (err, res){
        if (err) return callback(err);

        var diff = ( epoch() - start );

        object.exif = {
          data : res,
          time : diff
        };

        return callback(null, object);
      });
    },
    createWatermark : function (object, callback){

      if (!_config.watermark) return callback(null, object);

      var start = epoch();

      // Select the right watermark for the job.

      var grav = _config.watermark.gravity || 'south';

      var gravity = sharp.gravity[grav];


      selectWatermarkOwerlayImage(object.sourceImage.metadata, function (err, watermarkBuffer, metadata){
        if (err) return callback(err);

        sharp(object.sourceImage.buffer)
          .overlayWith(watermarkBuffer, { gravity: gravity } )
          .quality(100)
          .jpeg()
          .toBuffer(function (err, buffer){
            if (err) return callback(err);
            var diff = ( epoch() - start );

            object.watermark = {
              buffer : buffer,
              time : diff,
              metadata: metadata
            };


            return callback(null, object)
          });
      });

    },
    createSource : function (object, callback){
      var start = epoch();

      sharp(object.originalImage.buffer)
        .resize(_config.source.size.height, _config.source.size.width)
        .max()
        .toFormat(_config.source.format || 'jpeg')
        .quality(_config.source.quality || 100 )
        .withMetadata()
        .toBuffer(function (err, buffer ,metadata){
          if (err) return callback(err);

          var diff = ( epoch() - start );

          object.sourceImage = {
            buffer : buffer,
            time : diff,
            metadata : metadata
          };
          callback(null, object);
        });
    },
    createThumbnails : function (object, callback){


      var start = epoch();

      var inputBuffer = (_config.watermark) ? object.watermark.buffer : object.sourceImage.buffer;

      object.thumbnails = u.getThumbnailsName(object.filename, _config.thumbnails);
      async.eachOfLimit(object.thumbnails, 1, function (value, key, next){

        var size = {};

        if (object.sourceImage.metadata.height >= object.sourceImage.metadata.width){
          size.height = value.profile.maxsize;
        }else if (object.sourceImage.metadata.height <= object.sourceImage.metadata.width){
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

            object.thumbnails[key].buffer = buffer;
            object.thumbnails[key].time = diff;
            object.thumbnails[key].metadata = metadata;


            next();
          });


      }, function (err){
        inputBuffer = null;
        if (err) return callback(err);

        return callback(null, object);
      });

    },
    indexExif : function (object, callback){

      if (!_config.index) return callback(null, object);
      var start = epoch();

      var metadata = object.exif.data;
      metadata.archive = object.archive;
      metadata.archive_id = u.md5(object.archive);
      metadata.filename = object.filename;
      metadata.indexed_epoch = start;
      metadata._thumbnails = getThumbnailsLocations(object.thumbnails);
      metadata.slug = u.slug(object.filename);
      metadata.filename_md5 = u.md5(object.filename);

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
        if (err) return callback(err);
        var diff = ( epoch() - start );

        object.indexTime = diff;

        callback(null, object);
      });
    },
    storeThumbnails : function (object, callback){
      var start = epoch();
      // store thumbnails..
      //
      // TODO: Add support for S3/Swift
      async.eachOfLimit(object.thumbnails, 1, function (value, key, next){

        var location = path.join(_config.thumbnails.destination.folder, value.name);


        var locationFolder = path.parse(location).dir;

        u.createDirecotry(locationFolder, function (){
          fs.writeFile(location, value.buffer, next);
        });


      }, function (err){
        if (err) return callback(err);
        var diff = ( epoch() - start );

        object.storeThumbnailsTime = diff;
        callback(null, object);

      });
    },
    storeSource : function (object, callback){
      var start = epoch();

      if (!_config.source.destination) return callback(null, object);

      var ext = (_config.source.format === 'jpeg') ? 'jpg' :  _config.source.format;

      var dstFilename = `${object.filename}.${ext}`;

      var dir = path.join(_config.source.destination, object.archive);

      var destination = path.join(dir, dstFilename);

      u.createDirecotry(dir, function (err){
        if (err) return callback(err);

        fs.writeFile(destination, object.sourceImage.buffer, function (err, res){
          if (err) return callback(err);

          var diff = ( epoch() - start );

          object.storeSoruceTime = diff;

          callback(null, object);
        });
      })

    }
  };

};


module.exports = pipeline;

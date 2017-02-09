'use strict'
var sharp = require('sharp');
var async = require('async');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var _utils = require('./utils.js');
var tinytim = require('tinytim');

var Converter = require('./converter.js');



var Thumbnails = function (options, log){
  this.options = options;
  this.log = log;
  // read file buffer and save it
  this.watermarkImageBuffer = fs.readFileSync(options.watermark.image);
  return this;
}

Thumbnails.prototype.create = function (fileObject, callback) {
  var self = this;
  var options = this.options;

  var profiles = options.profile;

  var input = fileObject.path;


  fileObject.thumbnailDestinationObject = createFilenameObject(input);

  if (fileObject._source_image_buffer){
    fileObject._scaledImageBuffer = fileObject._source_image_buffer;

    return self._start(fileObject, callback);
  }

  // read the file buffer
  fs.readFile(input, function inputFileBuffer(err, fileBuffer){
    if (err) return callback(err);
    fileObject._scaledImageBuffer = fileBuffer;
    self._start(fileObject, callback);

  });

};

function getFileName(p){
  return path.parse(p).name;
}

Thumbnails.prototype._start = function(fileObject, callback){
  var self = this;


  // Create create watermarked version of the image ...
  self.log.info('Creating watermark image from:', getFileName(fileObject.path));


  self.createWatermark(fileObject, function (err, watermarkedImageBuffer){
    if (err) return callback(err);

    fileObject._watermarkedImageBuffer = watermarkedImageBuffer;

    self.createThumbsfromProfile(fileObject, callback);

  });
}
Thumbnails.prototype.createWatermark = function (fileObject, callback){
  var self = this;
  var options = this.options;
  var grav = options.gravity || 'south';

  var gravity = sharp.gravity[grav];

  var availableGravity = Object.keys(sharp.gravity);
  if (gravity === undefined) return callback(new Error(`${grav} is not a supported gravity supported are: ${availableGravity}`));

  self.createWatermarkSource(fileObject, function (err, watermarkBuffer){
    if (err) return callback(err);

    sharp(fileObject._scaledImageBuffer)
      .overlayWith(watermarkBuffer, { gravity: gravity } )
      .quality(100)
      .jpeg()
      .toBuffer(callback);
  });
}
Thumbnails.prototype.createWatermarkSource = function (fileObject, callback) {
  var self = this;

  var options = self.options;
  var size = options.maxSize || 0.7;

  metadata(fileObject._scaledImageBuffer, function (err, imageMetadata){
    if (err) return callback(err);


    self.log.debug('Create watermark souce', imageMetadata);

    var watermarkImagefilename = getFileName(options.watermark.image);

    var parsed = path.parse(fileObject.path);
    /**
     * Creates a max size of image..
     */
    var max = {
       height : _roundDown(imageMetadata.height  * size),
       width  : _roundDown(imageMetadata.width   * size)
    };
    max.height  = (max.height < max.width)  ? max.height : max.width;
    max.width   = (max.height > max.width)  ? max.width  : max.height;
    var name = `${watermarkImagefilename}-${max.height}x${max.width}.png`;
    var destination = path.join(options.watermark.cache || '.cache', name);
    // Create a watermark in right size
    if (_utils.exists(destination)){
      self.log.debug('Watermark image exists, fetching from disk', destination);
      return fs.readFile(destination, callback);
    }
    sharp(self.watermarkImageBuffer)
      .resize(max.height, max.width)
      .max()
      .toFormat('png')
      .quality(100)
      .toBuffer(function (err, buffer){
        if (err) return callback(err);
        fs.writeFile(destination, buffer, function (err, res){
          callback(err, buffer);
        });
      });

  });

};


Thumbnails.prototype.createThumbsfromProfile = function(fileObject, callback){
  // get metadata about the image to be used
  var self = this;

  var profiles = self.options.profile;
  fileObject._thumbnails = {}

  metadata(fileObject._watermarkedImageBuffer, function (err, metadata){
    async.forEachLimit(profiles, 1, function (item, next){


      var profileName = Object.keys(item).pop();

      var profile = item[profileName];

      fileObject.thumbnailDestinationObject.profile = profileName;

      var destinationName = formatString(self.options.destination.name, fileObject.thumbnailDestinationObject);

      var destination = path.join(self.options.destination.folder, destinationName);
      var objectToCreateThumbnailFrom = {
        path : fileObject._watermarkedImageBuffer,
        dst : destination
      }

      fileObject._thumbnails[profileName] = destinationName;

      var size = {};

      if (metadata.height >= metadata.width){
        size.height = profile.maxsize;
      }else if (metadata.height <= metadata.width){
        size.width = profile.maxsize;
      }
      var converter = new Converter( {size : size, quality : profile.quality });
      // when done, then just call next one
      converter.convert(objectToCreateThumbnailFrom, function doneCreatingThumbnail(err, outputBuffer){
        if (err) self.log.warn(err);

        next();
      });

      converter = null;
    }, callback);
  });

}

function metadata(filename, callback){
  return sharp(filename).metadata(callback);
}
function _roundDown(number){
  return Math.floor((number) / 100) * 100;
}

function md5(string){

  if (typeof string === 'object'){
    string = JSON.stringify(string);
  }
  return crypto.createHash('md5').update(string).digest('hex');
}




function formatString(template, object){
  return tinytim.render(template, object);
}



function splitBy(string, int){
  var arr = [];

  for (var i = int; i <= string.length; i = i +2){
    var start = i - 2;
    var str = string.substring(start, i);
    arr.push(str);
  }

  return arr;
}
// FIXME: More options here.
function createFilenameObject(filename){
  var parsedFileName = path.parse(filename);
  var nameHash = md5(parsedFileName.name);
  return {
    l1 : nameHash.charAt(nameHash.length -1),
    l2 : nameHash.substring(nameHash.length -3, nameHash.length -1),
    filename : parsedFileName.name,
    hash : nameHash
  };
}


module.exports = Thumbnails

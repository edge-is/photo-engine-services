'use strict'
var sharp = require('sharp');
var async = require('async');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var resize = require('./resize.js');

var _utils = require('./utils.js');

var tinytim = require('tinytim');

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


function createWatermark(sourceImageBuffer, options, callback){

  var grav = options.gravity || 'south';

  var gravity = sharp.gravity[grav];

  var availableGravity = Object.keys(sharp.gravity);
  if (gravity === undefined) return callback(new Error(`${grav} is not a supported gravity supported are: ${availableGravity}`));

  createWatermarkSource(sourceImageBuffer, options, function (err, watermarkBuffer){
    sharp(sourceImageBuffer)
      .overlayWith(watermarkBuffer, { gravity: gravity } )
      .quality(100)
      .jpeg()
      .toBuffer(callback)
  });
}

function createWatermarkSource(sourceImageBuffer, options, callback){
  var size = options.maxSize || 0.7;
  metadata(sourceImageBuffer, function (err, imageMetadata){
    if (err) return callback(err);
    var parsed = path.parse(options.image);
    /**
     * Creates a max size of image..
     */
    var max = {
       height : _roundDown(imageMetadata.height  * size),
       width  : _roundDown(imageMetadata.width   * size)
    };
    max.height  = (max.height < max.width)  ? max.height : max.width;
    max.width   = (max.height > max.width)  ? max.width  : max.height;
    var name = `${parsed.name}-${max.height}x${max.width}${parsed.ext}`;
    var destination = path.join(options.cache || '.', name);
    var fileObject = {
      path : options.image,
      dst : destination
    };
    // Create a watermark in right size
    if (_utils.exists(fileObject.dst)){
      return fs.readFile(fileObject.dst, callback);
    }

    resize(fileObject, {size : max, format: 'png', quality : 100 }, callback);
  });
}


function formatString(template, object){
  return tinytim.render(template, object);
}

function createThumbsfromProfile(imageBuffer, locationObject, profiles, callback){
  // get metadata about the image to be used
  metadata(imageBuffer, function (err, metadata){
    async.forEachLimit(profiles, 1, function (item, next){

      locationObject.profile = Object.keys(item).pop();

      var profileName = Object.keys(item).pop();

      var profile = item[profileName];

      var destination = formatString(locationObject._destination, locationObject);
      var fileObject = {
        path : imageBuffer,
        dst : destination
      }

      var size = {};

      if (metadata.height >= metadata.width){
        size.height = profile.maxsize;
      }else if (metadata.height <= metadata.width){
        size.width = profile.maxsize;
      }
      // when done, then just call next one
      resize(fileObject, {size : size, quality : profile.quality }, function doneCreateingThumb(err, outputBuffer){
        if (err) console.log(err);

        next();
      });
    }, callback);
  });

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
function createThumbnails(fileObject, options, callback){

  var profiles = options.profile;

  var input = fileObject.path;

  var locationObject =createFilenameObject(input);

  locationObject._destination = options.destination;

  // create Buffers
  //
  fs.readFile(input, function inputFileBuffer(err, fileBuffer){
    createWatermark(fileBuffer, options.watermark, function (err, watermarkedImageBuffer){
      if (err) return callback(err);

      createThumbsfromProfile(watermarkedImageBuffer, locationObject,  options.profile, callback);

    });
  });



}

module.exports = createThumbnails

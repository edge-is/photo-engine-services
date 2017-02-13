var sharp = require('sharp');

var path = require('path');

var fs = require('fs');

var _utils = require('./utils.js');

var Converter = function (options, log){
  this.options = options;
  this.log = log;
  return this;
};

Converter.prototype.convert = function (fileObject, callback) {
  var self = this;
  var input = fileObject.path;

  var output = fileObject.dst;

  var size = self.options.size;

  var format = self.options.format || 'jpeg';

  var quality = self.options.quality || 100;

  var _format = sharp.format[format];
  if (!_format) return callback(new Error(`Format not supported ${format}`));

  var parsed = path.parse(output);

  if (!_utils.exists(parsed.dir)){
    _utils.mkdirp(parsed.dir);
  }

  if (input instanceof Buffer){
    return reSizeIt(input, callback);
  }

  fs.readFile(input, function (err, buffer){
    if (err) return callback(err);
    reSizeIt(buffer, callback);
  });

  function reSizeIt(inputBuffer, callback){

    var _sharp = sharp(inputBuffer)
      .resize(size.height, size.width)
      .max()
      .toFormat(_format)
      .quality(quality);

      if (self.options.metadata){
        _sharp.withMetadata();
      }

      _sharp.toBuffer(function (err, outputBuffer){
        if (err) return callback(err);
        fs.writeFile(output, outputBuffer, function (err, res){
          // Delete after...
          fileObject = null;
          inputBuffer = null;
          callback(err, outputBuffer);
        });
      });
  }
};

module.exports = Converter;

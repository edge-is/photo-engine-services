var sharp = require('sharp');

var path = require('path');

var fs = require('fs');

var _utils = require('./utils.js');

function resize(fileObject, options, callback){

  var input = fileObject.path;

  var output = fileObject.dst;

  var size = options.size;

  var format = options.format || 'jpeg';

  var quality = options.quality || 100;

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

  function reSizeIt(buffer, callback){
    sharp(buffer)
      .resize(size.height, size.width)
      .max()
      .toFormat(_format)
      .quality(quality)
      .toBuffer(function (err, buffer){
        if (err) return callback(err);
        fs.writeFile(output, buffer, function (err, res){
          callback(err, buffer);
        });
      });
  }

}


module.exports = resize;

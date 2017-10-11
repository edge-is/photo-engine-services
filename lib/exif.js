const fs = require('fs');
const parseString = require('xml2js').parseString;
const path = require('path');
const crypto = require('crypto');

const aliases = [
    { key: "Description", value: "Comment" },
    { key: "Title", value: "ObjectName" },
    { key: "UserDefined3", value: "ObjectTypeReference" },
    { key: "Subject", value: "Keywords" },
    { key: "Instructions", value: "SpecialInstructions" },
    { key: "Rights", value: "CopyrightNotice" },
    { key: "PixelXDimension", value: "ExifImageWidth" },
    { key: "PixelYDimension", value: "ExifImageHeight" },
    { kye: "CreateDate", value: "DateCreated" }
];
const dates = [
  'CreateDate',
  'XMPFileStamps',
  'ReleaseDate'
];
const keysToRemove = [
  'xapMM','xap','exif','tiff',
  'photoshop','fwl','fwu','Iptc4xmpCore','dc'
];


var Exif = function (options, log){
  var self = this;
  self.options = options ||{};

  self.options.len = self.options.len || 40000;
  self.log = log;
};


Exif.prototype.fetch = function (filename, callback ) {
  var self = this;
  // check if filename is a buffer
  if (filename instanceof Buffer){
    return self._capture(filename, true, callback);
  }

  var parsed = path.parse(filename);

  var fileext = parsed.ext.toLowerCase();

  var supportedImages = ['.jpg', '.jpeg', '.tif', '.tiff'];

  if (supportedImages.indexOf(fileext) === -1 ){
    return callback(`'${parsed.ext}' is not supported extension`);
  }

  self._capture(filename, false, callback);
};

Exif.prototype.read = Exif.prototype.fetch;
function md5(string){

  if (typeof string === 'object'){
    string = JSON.stringify(string);
  }
  return crypto.createHash('md5').update(string).digest('hex');
}

function readFilePart(filename, offset, length, callback){
  var buffer = new Buffer(length);

  fs.open(filename, 'r', function (err, fd){
    if (err) return callback(err);

    fs.read(fd, buffer, 0, length, offset, function(err, num) {
      if (err) return callback(err);
      var string = buffer.toString('utf-8', 0, num);

      // Delete the buffer after parse to string
      buffer = null;
      return callback(null, string);
      //

    });
  });
}

Exif.prototype._capture = function (filename, isBuffer, callback) {
  var self = this;

  var options = self.options;

  var type = options.type;

  var length = options.len;

  var offset = 0;
  // type can override the type of image

  if (isBuffer){
    var bufferLength = filename.length;

    if (type === 'tif'){
      offset = bufferLength - options.len;
    }

    var end = offset + options.len;

    if (end > bufferLength){
      end = bufferLength;
    }


    var string = filename.toString('utf-8', offset, end);

    // Delete after to string..
    filename = null;
    return self._parseExtractedXMP(string, callback);
  }

  // Buffer size of 10000 is enough to capture the xmpmeta
  var parsed = path.parse(filename);

  var fileext = parsed.ext.toLowerCase();

  fs.stat(filename, function (err, stat){
    if (err) return callback(err);


    if (/tif/.test(fileext)){
      offset = stat.size - length;
    }

    options.file = options.file || filename;

    readFilePart(filename, offset, length, function (err, string){
      // Delete filename after.
      filename = null;
      if (err) return callback(err);
      self._parseExtractedXMP(string, callback);
    });
  })
};

Exif.prototype._parseExtractedXMP = function(string, callback){
  var self = this;

  var xml = extractXML(string);
  if (!xml) return callback('Could not extract XML');

  var fileNameAvailable = false;

  if (self.options.file){
    fileNameAvailable = true;
    var parsed = path.parse(self.options.file);
  }

  var object = parseXML(xml, function (err, res){
    if (err) return callback(err);
    if (fileNameAvailable){
      res.archive = getDirectory(parsed.dir);
      res.Directory = parsed.dir;
      res.SourceFile = self.options.file;
      res.FileName = parsed.name;
    }

    res.metadata_md5 = md5(res);
    callback(err, res);
  });
}

function getDirectory(dir){

  var parts = dir.split(path.sep);

  if (parts.length === 0) return '';

  return parts.pop();
}

function extractXML(string, callback){
  var anchor = new RegExp(/xmpmeta/);
  var xmpMetaStart = new RegExp(/\<x\:xmpmeta/);
  var lines = string.split('\n');
  var len = lines.length;
  var arr = [];
  var caputuring = false;

  // first get how many xmpmeta are in the string, and only return the last one

  var xmpMetaAt=[];
  lines.forEach(function (line, i){
    if (xmpMetaStart.test(line)) {
      xmpMetaAt.push(i);
    }
  });

  var lastMeta = xmpMetaAt.pop();

  var arr = lines.slice(lastMeta, len);

  arr.forEach(function (line){
    if (anchor.test(line)){
      caputuring = !caputuring;

      // get the last line in the array
      if (arr.length > 1) arr.push(line);
    }
    if (caputuring){
      arr.push(line);
    }
  });

  if (arr.length > 0) return arr.join('');

  arr = null;
  return false;
}

function parseExifKey(key){

  key = key.split(':');

  key = key.pop();

  return key;
}

function extraxtExifValue(value){
  var object = value.pop();

  var array, key = Object.keys(object)[0];

  if (Array.isArray(object[key])){
    array = object[key].pop();
  }else{
    array = object[key];
  }

  switch (key) {
    case 'rdf:Seq':
      return array['rdf:li'];
      break;

    case 'rdf:Alt':
      if (Array.isArray(array['rdf:li'])){
        var arr = array['rdf:li'].pop();
        return arr['_'];
      }
      if (typeof array === 'string'){
        return array;
      }
      return "";
      break;

    case 'rdf:Bag':
      return array['rdf:li'];
      break;

    default:
      return false;

  }

  return value;
}

function isDate(date){
  var d = new Date(date);
  if (d == 'Invalid Date') return false;
  return d;
}
function parseExifTimestamps(string){
  if (Array.isArray(string)){
    if (!isDate(string[0])) return string;
    return string.map(function (d){
      return new Date(d);
    });
  }
  var date = isDate(string);
  if (!date) return string;

  return date;
}

function prettifyObject(object){
  var _object = {};

  var numberRegex = new RegExp(/^[0-9]{1,100}$/);

  var keys = Object.keys(object);
  keys = keys.filter(function (key){
    return ( keysToRemove.indexOf(key) === -1 );
  });

  keys.forEach(function (key){
    var value = object[key];

    var _key = firstCharacterUpper(key);

    if (dates.indexOf(key) > -1){
      _object[_key] = parseExifTimestamps(value);
    }else{
      _object[_key] = value;
    }

    // if the value is number then parse it as number
    if (numberRegex.test(value)){
      var number = parseInt(value);

      if (!isNaN(number)){
        var numberKey = [_key, '_number'].join('');
        _object[numberKey] = number;
      }
    }
  });

  aliases.forEach(function (alias){
    var key = alias.key;
    var value = alias.value;
    if (_object[key]) _object[value] = _object[key];
  });

  return _object;
}

function firstCharacterUpper(string){
  if (typeof string !== 'string') return string;
  var parts = string.split('');

  parts[0] = parts[0].toUpperCase();

  return parts.join('');
}

function parseXML(xml, callback){
  var object = {};

  parseString(xml, function (err, result) {
    if (!result) return callback(`Metadata was not found`);

    var exif = result['x:xmpmeta']['rdf:RDF'][0]['rdf:Description'][0];

    for (var exifKey in exif['$']){
      var value = exif['$'][exifKey];

      var key = parseExifKey(exifKey);
      object[key] = value;
    }

    for (var exifKey in exif){
      if (exifKey == '$') continue;

      var key = parseExifKey(exifKey);
      var value = extraxtExifValue(exif[exifKey]);
      object[key] = value;
    }

    object = prettifyObject(object);
    callback(null, object);
  });

}

module.exports = Exif;

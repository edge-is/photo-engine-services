var fs = require('fs'),
  parseString = require('xml2js').parseString,
  path = require('path'),
  crypto = require('crypto');

function exif(filename, options, callback){
  if (typeof options === 'function'){
    callback = options;
    options = {};
  }

  var len = options.len || 10000;

  var parsed = path.parse(filename);

  var supportedImages = ['.jpg', '.jpeg'];

  if (supportedImages.indexOf(parsed.ext) === -1 ){
    return callback(new Error('NOT SUPPORTED EXTENSION'));
  }
  captureExif(filename, len, callback);
}

function md5(string){

  if (typeof string === 'object'){
    string = JSON.stringify(string);
  }
  return crypto.createHash('md5').update(string).digest('hex');
}

function captureExif(filename, length, callback){
  var buffer = new Buffer(length);
  var parsed = path.parse(filename);

  fs.open(filename, 'r', function (err, fd){
    if (err) return callback(err);
    fs.read(fd, buffer, 0, length, 0, function(err, num) {
      var string = buffer.toString('utf-8', 0, num);
      var xml = extractXML(string);
      var object = parseXML(xml, function (err, res){
        if (err) return callback(err);
        res.Directory = parsed.dir;
        res.SourceFile = filename;
        res.FileName = parsed.name;
        res.metadata_md5 = md5(res);
        callback(err, res);
      });
    });
  });
}

function extractXML(string, callback){
  var anchor = new RegExp(/xmpmeta/);
  var lines = string.split('\n');
  var arr = [];
  var caputuring = false;
  lines.forEach(function (line){
    if (anchor.test(line)){
      caputuring = !caputuring;

      // get the last line in the array
      if (arr.length > 1) arr.push(line);
    }
    if (caputuring){
      arr.push(line);
    }
  });


  return arr.join('');

}

function parseExifKey(key){

  key = key.split(':');

  key = key.pop();

  return key;
}

function extraxtExifValue(value){
  var object = value.pop();
  //console.log(JSON.stringify(object, null, 2));

  var key = Object.keys(object)[0];

  var array = object[key].pop();
  switch (key) {
    case 'rdf:Seq':
      return array['rdf:li'];
      break;

    case 'rdf:Alt':
      var arr = array['rdf:li'].pop();
      return arr['_'];
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

  var dates = ['CreateDate', 'XMPFileStamps', 'ReleaseDate'];
  var keysToRemove = ['xapMM','xap','exif','tiff','photoshop','fwl','fwu','Iptc4xmpCore','dc'];

  for (var key in object){
    if (keysToRemove.indexOf(key) > -1) continue;


    var parts = key.split('');
    parts [0] = parts[0].toUpperCase();

    var _key = parts.join('');

    var value = object[key];
    if (dates.indexOf(key) > -1){
      _object[_key] = parseExifTimestamps(value);

    }else{
      _object[_key] = value;
    }
  }
  var aliases = [
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

  aliases.forEach(function (alias){
    var key = alias.key;
    var value = alias.value;
    if (_object[key]) _object[value] = _object[key];
  });

  return _object;
}

function parseXML(xml, callback){
  var object = {};
  parseString(xml, function (err, result) {


    if (!result) return callback(new Error('METADATA NOT FOUND'));

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

module.exports = exif;

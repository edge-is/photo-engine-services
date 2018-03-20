const fs = require('fs');
const parseString = require('xml2js').parseString;
const path = require('path');
const crypto = require('crypto');
const Promise = require('bluebird');

Promise.promisifyAll(fs);

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
  'ReleaseDate',
  'ModifyDate',
  'MetadataDate'
];

function md5(input){
  return crypto.createHash('md5')
               .update(input)
               .digest('hex');
}


function sha1(input){
  return crypto.createHash('sha1')
               .update(input)
               .digest('hex');
}

function sha256(input){
  return crypto.createHash('sha256')
               .update(input)
               .digest('hex');
}


async function readFile(filename){

  const info = await Promise.all([
    fs.statAsync(filename),
    fs.readFileAsync(filename)
  ]);

  return {
    stat : info[0],
    buffer : info[1]
  };
}

function cleanArray(array){
  return array.filter(function (line){
    return !(/\s\s\s\s\s\s+/.test(line))
  })
}

function xmpParser(xmlObject){

  let object = {}
  let tempObject = {};
  xmlObject.forEach(function (obj){
    const keys = Object.keys(obj);
    keys.forEach(function (key){
      if (key === "$") {
          Object.keys(obj[key]).forEach(function (k){
            tempObject[k] = obj[key][k]
          })
      }else{


        tempObject[key] = obj[key];
      }
    })
    return tempObject;
  });

  xmlObject = tempObject;

  const keys = Object.keys(tempObject);

  keys.forEach(function (key){
    let value = tempObject[key];
    let k  = parseExifKey(key);

    if (Array.isArray(value)){
      object[k] = extraxtExifValue(value);
    }else{
      object[k] = value;
    }
  });

  return prettifyObject(object);
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

function parseHistory(arr){

  arr = arr.map(function (obj){
    if (obj['$']) return obj['$'];
    return false;
  }).filter(function (e){
    return e;
  })

  return arr.map(function (obj){
    let keys = Object.keys(obj);

    const output = {};

    keys.forEach(function (key){
      const value = obj[key];
      let parsedKey = key;

      if (key.indexOf(':') > -1){
        parsedKey = key.split(':').pop();
      }

      output[parsedKey] = value;
    });

    return output;
  });
}

function prettifyObject(object){
  let self = this;
  let output = {};

  let numberRegex = new RegExp(/^[0-9]{1,100}$/);
  let keys = Object.keys(object);

  if (object.History) {
    object.History = parseHistory(object.History);
  }

  keys.forEach(function (key){
    let value = object[key];

    if (typeof value === 'string'){
      value = value.replace(/\n/g, '');
    }

    let k = firstCharacterUpper(key);

    if (dates.indexOf(key) > -1){
      output[k] = parseExifTimestamps(value);
    }else{
      output[k] = value;
    }

    // if the value is number then parse it as number
    if (numberRegex.test(value)){
      let number = parseInt(value);

      if (!isNaN(number)){
        let numberKey = [k, '_number'].join('');
        output[numberKey] = number;
      }
    }
  });

  aliases.forEach(function (alias){
    var key = alias.key;
    var value = alias.value;
    if (output[key]) output[value] = output[key];
  });

  return output;
}

function parseExifKey(key){
  return key.split(':').pop();
}
function firstCharacterUpper(string){
  if (typeof string !== 'string') return string;
  var parts = string.split('');

  parts[0] = parts[0].toUpperCase();

  return parts.join('');
}


function extraxtExifValue(value){

  var object = value.pop();
  if (!object) return "could not extract value";

  if (typeof object === "string") return object;


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

async function captureXMP(content){
  const xmpStart = new RegExp('<x:xmpmeta');
  const xmpStop = new RegExp('</x:xmpmeta>');
  let capturing = false;

  let rawXmlLines = ['<xmlcontent>'];

  let lines = content.split('\n');


  let startAt = lines.findIndex(function (line){
    return xmpStart.test(line);
  });

  let arr = lines.slice(startAt, lines.length);

  arr.forEach(function (line){
    if (xmpStart.test(line)){
      capturing = true;
    }

    if (capturing) rawXmlLines.push(line);

    if (xmpStop.test(line)){
      capturing = false;
    }

  });

  rawXmlLines.push('</xmlcontent>');

  let xml = rawXmlLines.join('\n')
                .toString('utf8')
                .replace(/&/g,"&amp;")
                .replace(/-/g,"&#45;");


  return new Promise(function (resolve, reject){
    parseString(xml, function (err, res){

      if (err) return console.error(err);
      let arr = res.xmlcontent['x:xmpmeta'];

      // TIFF PARSER
      let metadata = arr.map(function (xmpMetadata){
        if (! Array.isArray(xmpMetadata['rdf:RDF'])) return false;
        let _metadata = xmpMetadata['rdf:RDF'].pop();

        if (! Array.isArray(_metadata['rdf:Description'])) return false;
        _metadata = _metadata['rdf:Description'];

        return _metadata;
      }).filter( function (item) { return item; });


      if (metadata.length === 0) return reject('Metadata not found');

      let array = metadata.map(xmpParser);
      return resolve(array);
    });
  });


}

function addChecksum(buffer, array){

  let checksums = {
    MD5 : md5(buffer),
    SHA1 : sha1(buffer),
    SHA256 : sha256(buffer),
  };

  return array.map(function (item){

    Object.keys(checksums).forEach(function (key){
      let value = checksums[key];
      let index = '_inputChecksum' + key;
      item[index] = value;

    });
    let metadataString = "";
    if (typeof item === 'object'){
      metadataString = JSON.stringify(item);
      item._metadataChecksumMD5    = md5(metadataString);
      item._metadataChecksumSHA1   = sha1(metadataString);
      item._metadataChecksumSHA256 = sha256(metadataString);
    }
    return item;
  });
}

function addTimestamps(array, stat){
  return array.map(function (object){

    const isStat = (stat instanceof fs.Stats);
    if (! isStat) return object;

    //if (typeof object !== 'object') return object;

    object.FileModifyDate = stat.mtime;
    object.FileAccessDate = stat.atime;
    object.FileInodeChangeDate = stat.ctime;
    object.SizeBytes=stat.size;

    return object;

  });
}

var XMP = function (options){
  options = options || {};
}



XMP.prototype.read = async function (fileOrBuffer) {

  const self = this;
  let buffer = false;
  let isBuffer = false;
  let stat = false;
  if (fileOrBuffer instanceof Buffer){
    isBuffer = true;
    buffer = fileOrBuffer;
    // Input is not a buffer, then read the file into buffer
  }else{
    const fileInfo = await readFile(fileOrBuffer);
    stat = fileInfo.stat;
    buffer = fileInfo.buffer;

  }

  // turn the buffer into utf-8 string
  let utf8Content = buffer.toString('utf-8');
  let arrayOfMetadata = await captureXMP(utf8Content);

  if (!isBuffer){
    let parsed = path.parse(fileOrBuffer);
    arrayOfMetadata = arrayOfMetadata.map(function (item){

      if (!item.Directory) item.Directory = path.resolve(parsed.dir);

      if (!item.Filename) item.Filename = parsed.base;
      if (!item._name) item._name = parsed.name;
      return item;
    });
  }

  arrayOfMetadata = addTimestamps(arrayOfMetadata, stat);
  arrayOfMetadata = addChecksum(buffer, arrayOfMetadata);

  return arrayOfMetadata;

};




module.exports = XMP;

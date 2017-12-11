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
  return fs.readFileAsync(filename);
}

function cleanArray(array){
  return array.filter(function (line){
    return !(/\s\s\s\s\s\s+/.test(line))
  })
}

function xmpParser(xmlObject){
  let object = {};

  let otherData = Object.keys(xmlObject).filter( line => (line != '$') )

  let basicData = xmlObject['$'];
  let basicDataKeys = Object.keys(basicData);

  // first the the basic values
  basicDataKeys.forEach(function (key){
    let value = basicData[key];

    let k  = parseExifKey(key);

    object[k] = value;

  });

  otherData.forEach(function (key){
    let k = parseExifKey(key);
    object[k] = extraxtExifValue(xmlObject[key]);
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

function prettifyObject(object){
  let self = this;
  let output = {};

  let numberRegex = new RegExp(/^[0-9]{1,100}$/);
  let keys = Object.keys(object);

  keys.forEach(function (key){
    let value = object[key];

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

  let xml = rawXmlLines.join('\n');

  return new Promise(function (resolve, reject){
    parseString(xml, function (err, res){


      if (err) return reject(err);

      let arr = res.xmlcontent['x:xmpmeta'];

      if (arr === undefined) return reject('Could not get X:XMPMETA');

      let metadata = arr.map(function (xmpMetadata){
        if (! Array.isArray(xmpMetadata['rdf:RDF'])) return false;
        let metadata = xmpMetadata['rdf:RDF'].pop();

        if (! Array.isArray(metadata['rdf:Description'])) return false;
        metadata = metadata['rdf:Description'].pop();

        return metadata;
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
      let index = 'inputChecksum' + key;
      item[index] = value;

    });
    let metadataString = "";
    if (typeof item === 'object'){
      metadataString = JSON.stringify(item);
      item.metadataChecksumMD5    = md5(metadataString);
      item.metadataChecksumSHA1   = sha1(metadataString);
      item.metadataChecksumSHA256 = sha256(metadataString);
    }
    return item;
  });
}

function parseHistory(array){

  function parseKey(key){
    if (key.indexOf(':') > -1) return key.split(':').pop();

    return key;
  }
  function parser(historyArray){
    if (!Array.isArray(historyArray)) return [];
    return historyArray.map(function (h){

      let obj = {};
      const keys = Object.keys(h['$']);

      keys.forEach(function (key){
        const value = h['$'][key];
        const prettyKey = parseKey(key);

        obj[prettyKey] = value;
      })
      return obj;
    });
  }

  return array.map(function (metadata){
    if (metadata.History){
      metadata.History = parser(metadata.History);
    }
    return metadata;
  });
}


var XMP = function (options){

  options = options || {};
}

XMP.prototype.read = async function (fileOrBuffer) {
  const self = this;
  let buffer = false;
  let isBuffer = false;
  if (fileOrBuffer instanceof Buffer){
    isBuffer = true;
    buffer = fileOrBuffer;
    // Input is not a buffer, then read the file into buffer
  }else{
    buffer = await readFile(fileOrBuffer);
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

  arrayOfMetadata = addChecksum(buffer, arrayOfMetadata);

  arrayOfMetadata = parseHistory(arrayOfMetadata);

  // FIX REMOVE UNVANTED shit
  arrayOfMetadata = arrayOfMetadata.map(function (item){
    if (item.RetouchAreas){
      delete item.RetouchAreas;
    }

    return item;
  })


  return arrayOfMetadata;

};




module.exports = XMP;

var exif = require('./exif.js');
var path = require('path');
var crypto = require('crypto');

var _utils = require('./utils.js');

var elasticsearch = require('elasticsearch');

function getArchivename(filename){
  return path.dirname(filename).split(path.sep).pop();
}

function md5(string){

  if (typeof string === 'object'){
    string = JSON.stringify(string);
  }
  return crypto.createHash('md5').update(string).digest('hex');
}

function index(fileObject, config, callback){
  var filename = fileObject.path;
  var parsed = path.parse(filename);
  exif(filename, function (err, metadata){
    if (err) return callback(err);
    var now = new Date().getTime();
    var archive = getArchivename(filename);

    metadata.archive = archive;
    metadata.archive_id = md5(archive);
    metadata.filename = parsed.name;
    metadata.indexed_epoch = now;

    metadata.slug = _utils.slug(parsed.name);

    metadata.filename_md5 = md5(parsed.name);

    elasticsearchIndex(metadata, config, callback);
  });
}
function cleanNoneIndexableFields(object, config){
  var noIndex = [
    'NativeDigest', 'DocumentID', 'StripByteCounts', 'ReferenceBlackWhite',
    'XMPToolkit', 'ApplicationRecordVersion', 'PageNumber', 'SampleFormat',
    'Directory', 'SourceFile', 'StripOffsets', 'DocumentName', 'JPEGTables',
    'FilePermissions', 'BitsPerSample', 'XMPFileStamps', 'XResolution', 'YResolution' ];
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
function toEpochs(object){
  var convert = ['CreateDate','ReleaseDate'];

  convert.forEach(function (value){
    object[value] = new Date(object[value]).getTime();
  });

  return object;
}

function elasticsearchIndex(object, config, callback){
  var client = new elasticsearch.Client(config.elasticsearch || 'localhost:9200');
  object = cleanNoneIndexableFields(object, config);
  object = toEpochs(object);
  var body = {
    index : config.index,
    type : config.type,
    body : object
  };
  body.id = object.slug;

  client.index(body, function indexElasticsearch(err, response){
    if (err) callback(err);
    callback(null, response);
  });
}



module.exports = index;

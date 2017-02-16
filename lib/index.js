var Exif = require('./exif.js');
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

var Indexer = function (config, log){
  var self = this;
  config.exif = config.exif || {};
  self.config = config;

  self.log = log;
  self.client =  new elasticsearch.Client(config.elasticsearch || 'localhost:9200');
};

Indexer.prototype.index = function(fileObject, callback){
  var self = this;
  var config = self.config;
  var filename = fileObject.path;
  var parsed = path.parse(filename);
  var exif = new Exif(config.exif);

  var fileToExtractFrom = fileObject._scaledImageBuffer;

  exif.fetch(fileToExtractFrom, function (err, metadata){
    if (err) return callback(err);
    var now = new Date().getTime();
    var archive = getArchivename(filename);

    metadata.archive = archive;
    metadata.archive_id = md5(archive);
    metadata.filename = parsed.name;
    metadata.indexed_epoch = now;

    if (fileObject._thumbnails){
      metadata._thumbnails = fileObject._thumbnails;
    }

    metadata.slug = _utils.slug(parsed.name);

    metadata.filename_md5 = md5(parsed.name);

    // FIXME: Hack for index shit... need to be unix cannot be null
    if (!metadata.CreateDate){
      metadata.CreateDate = now;
    }
    if (typeof metadata.DateCreated === 'string' ){
      metadata.DateCreated_string = metadata.DateCreated;
      metadata.DateCreated = now;
    }

    self.elasticsearchIndex(metadata, callback);
  });
}

function cleanNoneIndexableFields(object, config){
  var noIndex = [
    'NativeDigest', 'DocumentID', 'StripByteCounts', 'ReferenceBlackWhite',
    'XMPToolkit', 'ApplicationRecordVersion', 'PageNumber', 'SampleFormat',
    'Directory', 'SourceFile', 'StripOffsets', 'DocumentName', 'JPEGTables',
    'FilePermissions', 'BitsPerSample', 'XMPFileStamps', 'XResolution', 'YResolution', 'ModifyDate'];
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

Indexer.prototype.elasticsearchIndex = function(object, callback){
  var self = this;
  var config = self.config;

  var client = self.client;

  object = cleanNoneIndexableFields(object, config);
  object = toEpochs(object);
  var body = {
    index : config.index,
    type : config.type,
    body : object
  };
  body.id = object.slug;
  client.index(body, function indexElasticsearch(err, response){
    object = null;
    if (err) return callback(err);
    callback(null, response);
  });
}



module.exports = Indexer;

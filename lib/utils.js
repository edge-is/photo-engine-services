
var fs = require('fs');
var path = require('path');
var walk = require('walk');
var yaml = require('js-yaml');
var fs = require('fs');
var RedisSMQ = require("rsmq");

var mkdirp = require('mkdirp');

var duration = require('parse-duration');

var slug = require('slug');

var crypto = require('crypto');

slug.defaults.modes['pretty'] = {
    replacement: '-',
    symbols: true,
    remove: /[.]/g,
    lower: true,
    charmap: slug.charmap,
    multicharmap: slug.multicharmap
};

function _slug(string){
  return slug(string);
}

function _mkdirp(directory){
  return mkdirp.sync(directory);
}

function exists (filename, callback){

  if (typeof callback === 'function'){
    return fs.stat(filename, callback);
  }

  try {
    fs.statSync(filename);
    return true;
  } catch (e) {
    return false;
  }
}

var _JSON = {
  parse : function (string, callback){
    var cb = (typeof callback === 'function');
    try {
      var object = JSON.parse(string);

      if (cb) callback(null, object);
      return object;
    } catch (e) {
      if (cb) callback(e);
      return false;
    }
  },
  stringify : function (object, callback){
    var cb = (typeof callback === 'function');
    try {
      var json = JSON.stringify(object);

      if (cb) callback(null, json);
      return json;
    } catch (e) {
      if (cb) callback(e);
      return false;
    }
  }
}

function readConfig(filepath){
  if (!exists(filepath)) return console.log(`${filepath} does not exist`);

  var content = fs.readFileSync(filepath, 'utf8');
  try {
    return yaml.safeLoad(content);
  } catch (e) {
    console.log(e);
    return false;
  }

}

function parseDuration(string){
  try {
    return duration(string);
  } catch (e) {
    return 3600;
  }
}

function service(time, callback){

  if (typeof time === 'function'){
    callback = time;
    time = callback;
  }
  callback();

  var seconds = parseDuration(time)

  return setInterval(callback, seconds);

}

function rsmq(config){
  return new RedisSMQ( {host: config.redis.server , port: config.redis.port , ns: config.name || 'redismq' } );
}


function StatsTimesToEpoch(object){
  var _object = { };
  for (var key in object){
    var value = object[key];

    if (typeof value === 'function') continue;

    if (value instanceof Date){
      _object[key] = value.getTime();
    }else{
      _object[key] = value;
    }

  }

  return _object;
}
function scanFilesAndFolders(dir, logfile, callback){
      var walker = walk.walk(dir);
      var AllFiles = [];

      var AllDirectorys = [];
      var AllErrors = [];



      walker.on('file', function (root, stats, next){

        var filename = path.resolve(root, stats.name);

        var type = 'file';
        var object = {path : filename, stats : stats, type : type};
        AllFiles.push({path : filename, stats : stats});

        var _json = JSON.stringify({
            path : filename,
            type : type,
            stats : StatsTimesToEpoch(stats)
        });

        if (logfile) return  fs.appendFile(logfile, _json + '\n', next);

        next();
      });

      walker.on('directory', function (root, stats, next){
        var directory = path.resolve(root, stats.name);

        var type = 'directory';

        var object = {path : directory, stats : stats, type : type};
        AllDirectorys.push({path : directory, stats : stats});

        var _json = JSON.stringify({
            path : directory,
            type : type,
            stats : StatsTimesToEpoch(stats)
        });
        if (logfile) return fs.appendFile(logfile, _json + '\n', next);

        next();
      });


      walker.on("errors", function (file, nodeStatsArray, next){
        AllErrors = nodeStatsArray;
        next();
      });

      walker.on('end', function (){
        callback(null, {
          files : AllFiles,
          folders : AllDirectorys,
          logfile : logfile
        });
      });
};

function replaceExtension(filePath, ext){
  var p = path.parse(filePath);
  return [p.dir, path.sep, p.name, ext].join('');
}

/**
 * Compare files from source to destination
 * @param  {array}    array    Array of files
 * @param  {object}   options  Options
 * @param  {Function} callback Callback when done
 * @return {[type]}            [description]
 */

var EventsEmitter = require('events');

var Compare = function (src, dst, options){
  var self = this;
  options = options || {};

  self.src = src;

  self.dst = dst;
  self.overrideExtension = options.extension || false;

  self.srclogfile = options.srclogfile || false;
  self.dstlogfile = options.dstlogfile || false;
};

function toEpoch(date){
  return new Date(date).getTime();
}

Compare.prototype.start = function (){
  var self = this;
  var emitter = new EventsEmitter();

  var walker = walk.walk(self.src);

  var allFiles = [];

  walker.on('end', function (){
    emitter.emit('end', allFiles);
  });

  walker.on('directory', function (root, stats, next){
    emitter.emit('directory', stats);
    next();
  });


  walker.on("errors", function (file, nodeStatsArray, next){
    emitter.emit('errors', nodeStatsArray);
    next();
  });

  walker.on('file', function (root, stats, next){

    var _path = path.resolve(root, stats.name);
    var type = 'file';
    var object = { path : _path, stats : stats, type : type };

    // get destination filename

    var destination = getDestination(self.src, _path, self.dst);


    if (self.overrideExtension){
      var parsed = path.parse(destination);
      destination = replaceExtension(destination, self.overrideExtension);
    }

    var destinationDir = path.dirname(destination);

    object.dst = path.resolve(destination);
    stats.mtime = toEpoch(stats.mtime);

    stats.ctime = toEpoch(stats.ctime);


    var srcTime = (stats.mtime > stats.ctime) ? stats.mtime : stats.ctime;

    exists(object.dst, function (err, res){

      if (err) {
        next();
        allFiles.push(object);
        object.status = 'NOTEXISTING';
        return emitter.emit('file', object);
      }

      res.mtime = toEpoch(res.mtime);
      res.ctime = toEpoch(res.ctime);


      var dstTime = (res.mtime > res.ctime) ? res.mtime : res.ctime;


      if (srcTime > dstTime){
        object.status = 'MODIFIED';
        object._times = {
          srcTime: srcTime,
          dstTime: dstTime
        }
        allFiles.push(object);
        emitter.emit('file', object);
      }

      next();
    });
  });

  return emitter;

}
function getDestination(src, filename, dst){
  var relative = path.relative(src, filename);

  return path.join(dst, relative);
}

function createQueueSoft(rsmq, qname, callback){

  rsmq.listQueues(function (err, ques){
    if (err) return callback(err);

    if (ques.indexOf(qname) > -1) return callback(null, qname);

    rsmq.createQueue({ qname: qname }, function (err, resp) {
      if (err) return callback(err);

      err = err || {};

      if (err.name == 'queueExists' || resp === 1) return callback(null, qname);

    });
  });

}

function md5(data){

  return crypto.createHash('md5').update(data).digest("hex");
}



module.exports = {
  scan : scanFilesAndFolders,
  compare : Compare,
  service : service,
  readConfig:readConfig,
  rsmq : rsmq,
  JSON : _JSON,
  createQueue: createQueueSoft,
  exists : exists,
  mkdirp : _mkdirp,
  slug : _slug,
  md5 : md5
}

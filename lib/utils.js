
var fs = require('fs');
var path = require('path');
var walk = require('walk');

var duration = require('parse-duration');

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

var parseDuration(string){
  try {
    return duration(string);
  } catch (e) {
    return 3600;
  }
}

function service(callback, time){
  callback();

  var seconds = parseDuration(time)

  return setInterval(callback, seconds);

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
      var W = walk.walk(dir);
      var AllFiles = [];

      var AllDirectorys = [];
      var AllErrors = [];



      W.on('file', function (root, stats, next){

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

      W.on('directory', function (root, stats, next){
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


      W.on("errors", function (file, nodeStatsArray, next){
        AllErrors = nodeStatsArray;
        next();
      });

      W.on('end', function (){
        callback(null, {
          files : AllFiles,
          folders : AllDirectorys,
          logfile : logfile
        });
      });
};


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

  W.on('directory', function (root, stats, next){
    emitter.emit(directory, stats);
    next();
  });


  W.on("errors", function (file, nodeStatsArray, next){
    emitter.emit(nodeStatsArray);
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

      parsed.ext = self.overrideExtension;

      destination = path.format(parsed);
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



module.exports = {
  scan : scanFilesAndFolders,
  compare : Compare,
  service : service
}

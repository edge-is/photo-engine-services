'use strict';

var createPipeline = function (settings){

  var queue   = settings.queue;
  var status  = settings.status;
  var log     = settings.log;

  if (!queue || !status || !log){
    return console.error('I need queue, status and log',{
      queue   : (queue) ? true : false,
      status  : (status) ? true : false,
      log     : (log) ? true : false
    });
  }
 return {
    checkStatus : function (object, callback){

      //var fileID = object.fileID  + Math.random();
      log.info(`Checking status on ${object._fileID.input}`);
      status.get(object.fileID, function (err, res){
        if (err) return callback(err);
        if (res === null){
          object.existsInStatus = false;
          // File does not exist in status table-
          object.changed = true;

          return callback(null, object);
        }

        log.info(`Alread exists, checking status and timestamp`);
        status.hasChanged(object.fileID, object.stats, function (err,  hasChanged){
          if (err) {
            log.error('hasChanged', err);
            return callback(err);
          }
          log.info(`${object.fileID}:${object.path} has changed:${hasChanged}`);

          if (hasChanged) return callback(null, object);


          return callback(`${object.fileID}:${object.path} has not changed skipping`);
        });
      });

    },
    addToQueue : function (object, callback){
      object.status = "new";

      queue.add(object).then(function (stats){

        log.info(`Adding to queue:${stats.queue.name} with ID: ${stats.id}`);
        status.new(object.fileID, object.path, stats.queue.name, stats.id, object.stats, function (err, res){
          if (err) {
            log.error(`Error updating status of object ${object.fileID}`, err);
            return callback(err);
          }
          callback(null, object);
        });
      });
    }
  };
};

module.exports = createPipeline;

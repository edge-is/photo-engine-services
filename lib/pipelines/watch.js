'use strict';

var createPipeline = function (settings){

  var queue   = settings.queue;
  var status  = settings.status;
  var log     = settings.log;
  var config  = settings.config;

  if (!queue || !status || !log || !config){
    return console.error('I need queue, status and log',{
      queue   : (queue) ? true : false,
      status  : (status) ? true : false,
      log     : (log) ? true : false,
      config  : (config) ? true : false
    });
  }
 return {
    checkStatus : function (object, callback){

      if (config.forceScan) {
        log.info({fileID : object.fileID, file: object.path }, `Skipping checking status for file adding all items to queue`);
        return callback(null, object);
      }

      //var fileID = object.fileID  + Math.random();
      log.info({fileID : object.fileID, file: object.path }, `Checking status on ${object.path}`);
      status.get(object.fileID, function (err, res){
        if (err) return callback(err);
        if (res === null){
          object.existsInStatus = false;
          // File does not exist in status table-
          object.changed = true;

          return callback(null, object);
        }



        log.info({fileID : object.fileID, file: object.path }, `Image have been processed before, check file timestamps`);

        status.hasChanged(object.fileID, object.stats, function (err,  hasChanged){
          if (err) {
            log.error({fileID : object.fileID, file: object.path }, 'Error processing, [hasChanged]', err);
            return callback(err);
          }
          log.info({fileID : object.fileID, file: object.path }, `has changed:${hasChanged}`);

          if (hasChanged) return callback(null, object);

          return callback(`${object.fileID}:${object.path} has not changed skipping`);
        });
      });

    },
    addToQueue : function (object, callback){
      object.status = "new";

      queue.add(object, {
         jobId : object.fileID,
         removeOnComplete: true
       }).then(function (stats){

        log.info({fileID : object.fileID, file: object.path }, `Adding to queue:${stats.queue.name} with ID: ${stats.id}`);
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

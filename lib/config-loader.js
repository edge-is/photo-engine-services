'use strict'


const fs = require('fs');
const yaml = require('js-yaml');
const EventEmitter = require('events');
const ev = new EventEmitter();


var configLoader = function (configfile, callback){
  callback = callback || function (){};

  function readConfig(){
    fs.readFile(configfile, 'utf8', function (err, content){
      if (err){
        ev.emit('error', err);
        return callback(err);
      }

      var config = false;

      try {
        config = yaml.safeLoad(content);
      } catch (e) {
        ev.emit('error', e);
        return callback(e);
      }

      ev.emit('ready', config);
      callback(null, config);

    });
  }

  readConfig();

  process.on('SIGHUP', function (){

    ev.emit('reload');
    readConfig();
  });

  return ev;
};

module.exports = configLoader;

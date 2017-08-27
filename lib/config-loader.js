'use strict'


const fs = require('fs');
const yaml = require('js-yaml');
const EventEmitter = require('events');
const ev = new EventEmitter();
const path = require('path');

var configLoader = function (configfile){

    // Read configfile, and then read directory
  var configContent = fs.readFileSync(configfile, 'utf8');


  var config = yaml.safeLoad(configContent);

  if (typeof config.include === 'string'){
    config.servers = readConfigDirectory(config.include);
  }

  return config;
};

function readConfigDirectory(configDirectory){
  var files = fs.readdirSync (configDirectory);

  var matchYml = new RegExp(/\.yml$/);

  var filesToLoad = files.filter(function (file){
    return matchYml.test(file);
  });

  var configArray = filesToLoad.map(function (filename){
    var file = path.join(configDirectory, filename);
    var yml =  loadYaml(file);
    if (yml){
      yml.__filename = file;
    }
    return yml;
  }).filter(function (e){return e;});
  return configArray;
}

function loadYaml(file){
  try {
    var content = fs.readFileSync(file);
    return yaml.safeLoad(content);
  } catch (e) {
    return false;
  }
}

module.exports = configLoader;

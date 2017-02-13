


var _utils = require('./lib/utils.js');

var path = require('path');

var argv = require('yargs').argv;
var fs = require('fs');
var walk = require('walk');

var folder = argv.f;


if (!folder){
  return console.log('-f for folder, exit');
}

var t = argv.t || '30s';

_utils.service(t, function (){

  var walker = walk.walk(folder);

  var files = [];



  walker.on('file', function (root, stats, next){

    var f = path.join(root, stats.name);

    files.push(f);

    next();
  });

  walker.on('directory', function (root, stats, next){
    next();
  });


  walker.on("errors", function (file, nodeStatsArray, next){
    next();
  });

  walker.on('end', function (){

    var int = randomNumber(0, files.length -1);
    var selected = files[int];

    if (!selected) return;
    console.log('Deleteing', selected);
    fs.unlink(selected, function (err, res){
      if (err) return console.log(err);
      console.log('Unkink', selected);
    });
  });

});


function randomNumber(min,max){
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

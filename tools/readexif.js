

const argv = require('yargs').argv;
const fs = require('fs');
const async = require('async');

const XMP = require('../lib/xmp.js');

const file = argv._.pop();


const list = argv.list || false;

var xmp = new XMP();



if (process.stdin.isTTY === undefined){
  // Pipe is on ..
  //
  //process.stdin.resume();
  process.stdin.setEncoding('utf8');

  let string = "";
  process.stdin.on('data', function(chunk) {
    string +=chunk;
  });

  return process.stdin.on('end', function() {
    let array = string.split('\r\n');

    array = array.filter(function (item){
      return item.length > 0;
    });

    async.forEachLimit(array, 1, function (file, next){
      xmp.read(file).then(function (metadata){
        return processMetadata(metadata, next);
      }).catch(function (err){
        if (err.code === 'ENOENT'){

          console.error(`'${file} does not exist'`);
          return next();
        }
        console.error(err);
        next();
      });
    })

  });
}else if(list){
  var array = fs.readFileSync(list).toString('utf-8').split('\n');
  array = array.map(function (item){
    return item.replace(/\r/g, '');
  });

  array = array.filter(function (item){
    return (item.length > 1);
  });

  return async.forEachLimit(array, 1, function (file, next){
    xmp.read(file).then(function (metadata){
      return processMetadata(metadata, next);
    }).catch(function (err){
      if (err.code === 'ENOENT') {
        console.error(`'${file} does not exist'`);
        return next();
      }

      console.error(err);
    });
  }, function done(){
    console.log(`All files done`);
  })
}else{
  return xmp.read(file).then(processMetadata).catch(function (err){
    if (err.code === 'ENOENT') return console.error(`'${file} does not exist'`);

    console.error(err);
  });
}

function addIndex(arr){
  let len = arr.length;
  return arr.map(function (item, index){
    let c =  [index + 1 , len].join('/');
    item._metadataIndex = [item._name, c].join(':');
    return item;
  })
}


function processMetadata(metadata, callback){
  callback = callback || function (){};
  metadata = addIndex(metadata);


  if (!argv.a) metadata = metadata.pop();

  if (!Array.isArray(metadata)){
    metadata = [metadata];
  }



  if (argv.j){

    console.log(JSON.stringify(metadata, null, 2));
    return callback();
  }


  metadata.forEach(function (meta, index){
    let i = index + 1;
    prettyPrint(meta, i, metadata.length);
  });

  callback();
}




function prettyPrint(metadata, i, len){
  const padding = 5;

  let keys = Object.keys(metadata);
  let longest = keys.reduce(function (a , b){



    if (a.length >= b.length) return a;
    if (a.length <= b.length) return b;
  }).length;

  function getPadding(len){
    let arr = [];

    for (let i = 0; i < len; i++){
      arr.push(' ');
    }

    return arr.join('');

  }

  const total = padding + longest;
  console.log(`
    Metadata edited at ${metadata.MetadataDate}
    metadata ${i} / ${len}
  `);
  keys.forEach(function (key){
    let value = metadata[key];

    let padd = getPadding(total - key.length);



    console.log(`${padd} ${key} : ${value}`);

  })
  console.log(`
    ---------------- End of metadata --------------------
    `);
}

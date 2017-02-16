function removeBuffers(object){
  var _newObject = {};


  if (isBuffer(object)){
    return _removeBuffer(object);
  }


  if (typeof object !== 'object'){
    return _removeBuffer(object);
  }

  for (var key in object){
    var value = object[key];


    _newObject[key] = _removeBuffer(value);

  }
    return _newObject;
}

function _removeBuffer(value){
  if (Array.isArray(value)){
    return value.map(removeBuffers);
  }

  if (typeof value === 'object' && !isBuffer(value)){
    return removeBuffers(value);
  }
  if (!isBuffer(value)){
    return value;
  }

  if (isBuffer(value)){
    return 'Buffer removed';
  }
}

function isBuffer(buff){
  return (buff instanceof Buffer)
}

module.exports=removeBuffers;

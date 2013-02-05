/*
 * Copyright (c) 2013 Bryan Conrad
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

var InDescription = require('./in_description');
var OutDescription = require('./out_description');

/**
 * @brief A class for packing/unpacking values as a set number of bits
 */
function Bitstream (buffer) {
  this.arr = [];
  this.length = 0;
  this._index = 0;
  if (buffer instanceof Buffer) {
	  this.fromArrayBuffer(buffer);
  }
}Array

Bitstream.prototype = {
    constructor: Bitstream
  , toArrayBuffer: function () {
	  var arr = new Buffer(this.length / 8);

	  var bitOffset;
	  var val;
	  for (var i = 0; i < arr.length; i++) {
		  bitOffset = (8 * (i % 4));
		  val = (this.arr[Math.floor(i / 4)] & (0xFF << bitOffset)) >> bitOffset;
 
		  if (val) {
		  console.log('encoding: ' + val);
		  }
		  arr[i] = val;
	  }
	return arr;
  }

  , fromArrayBuffer: function (buffer) {
	  this.arr = [];
	  this.length = Math.ceil(buffer.length / 4);
	  var myIndex = 0;
	  for (var i = 0; i < buffer.length; i++) {
		  myIndex = Math.floor(i / 4);
		  this.arr[myIndex] =
			  this.arr[myIndex] |
			  (buffer[i] << 8 * (i % 4));
	  }
  }

  , toString: function () {
      vals = [];
      for (var i = this.length - 1; i >= 0; --i) {
        vals [i] = this.get (i) ? "1" : "0";
      }
      return vals.join ("");
    }

  , clear: function (i) {
      if (i >= this.length) {
        this.length = i + 1;
      }
      var pos = i / 32 | 0;
      this.arr [pos] = this.arr [pos] & ~(1 << i % 32);
    }

  , get: function (i) {
      return (this.arr [Math.floor (i / 32 | 0)] & 1 << i % 32) > 0;
    }

  , serialize: function () {
      var str = "";
      for (var i = 0; i < this.arr.length; ++i) {
        var num = this.arr [i];
        str += num < 0
          ? (-num).toString (36) + Bitstream.NEGATIVE_DELIM
          : num.toString (36) + Bitstream.POSITIVE_DELIM
          ;
      }
      var trailingLength = this.length % 32;
      if (trailingLength == 0) {
        trailingLength = 32;
      }
      if (this.length == 0) {
        trailingLength = 0;
      }
      return str + trailingLength.toString (36);
    }

  , set: function (i) {
      if (i >= this.length) {
        this.length = i + 1;
      }
      var pos = i / 32 | 0;
      this.arr [pos] = this.arr [pos] | 1 << i % 32;
    }

  , size: function () {
      return this.length;
    }

    /**
     * @brief read an unsigned integer consuming the specified number of bits
     */
  , readUInt: function (bits) {
	  var result = 0;
	  var i;
	  for (i = 0; i < bits; i++) {
		  result |= this.get(this._index) << i;
		  this._index += 1;
	  }

	  return result;
    }

    /**
     * @brief write an unsigned integer using the specified number of bits
     */
  , writeUInt: function (value, bits) {
	  var mask = 1;
	  var i;
	  for (i = 0; i < bits; i++) {
		  if (value & mask) {
			  this.set(this._index);
		  } else {
			  this.clear(this._index);
		  }
		  this._index += 1;
		  mask <<= 1;
	  }
    }

    /**
     * @brief pack an object with a .serialize() method into this bitstream
     */
    , pack: function (obj) {
	    var description = new InDescription;
	    description._bitStream = this;
	    description._target = obj;
	    obj.serialize(description);
    }

    /**
     * @brief unpack an object with a .serialize() method from this bitstream
     */
    , unpack: function (obj) {
	    var description = new OutDescription;
	    description._bitStream = this;
	    description._target = {};
	    obj.serialize(description);
	    return description._target;
    }
};

Bitstream.POSITIVE_DELIM = ".";
Bitstream.NEGATIVE_DELIM = "!"

Bitstream.deserialize = (function () {
  var MATCH_REGEX = new RegExp (
      "[A-Za-z0-9]+(?:"
      + Bitstream.POSITIVE_DELIM
      + "|"
      + Bitstream.NEGATIVE_DELIM
      + ")?"
    , "g");
  return function (str) {
    var bm = new Bitstream ();
    var arr = str.match (MATCH_REGEX);
    var trailingLength = parseInt (arr.pop (), 36);
    for (var i = 0; i < arr.length; ++i) {
      var str = arr [i];
      var sign = str.charAt (str.length - 1) == Bitstream.POSITIVE_DELIM ? 1 : -1;
      bm.arr [i] = parseInt (str, 36) * sign;
    }
    bm.length = Math.max ((arr.length - 1) * 32 + trailingLength, 0);
    return bm;
  };
}) ();

module.exports = Bitstream;

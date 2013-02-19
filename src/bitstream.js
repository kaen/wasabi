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
    if (buffer) {
        this.fromArrayBuffer(buffer);
    }
}

Bitstream.prototype = {
    constructor: Bitstream
    , setBits: function (offset, n, value) {
        var bits
            , cell
            , cellOffset
            , mask
            , nbits
            ;
        cell = Math.floor(offset / 7);
        cellOffset = offset % 7;

        while (n > 0) {
            // determine how many bits will fit into the current cell
            nbits = Math.min(n, 7 - cellOffset);

            // make an all-set bitmask with length of nbits
            mask = (1 << nbits) - 1;

            // get the next nbits bits from the value
            bits = value & mask;

            // move the bits and mask to the correct cell offset
            bits <<= cellOffset;
            mask <<= cellOffset;

            // set the cells bits
            this.arr[cell] = (this.arr[cell] & (~mask)) | bits ;

            // prepare for next iteration
            value >>= nbits;
            n -= nbits;
            cellOffset = 0;
            cell++;
        }
    }

    , getBits: function (offset, n) {
        var bits
            , cell
            , cellOffset
            , mask
            , nbits
            , value
            , valueOffset
            ;
        cell = Math.floor(offset / 7);
        cellOffset = offset % 7;
        value = 0;
        valueOffset = 0;

        while (n > 0) {
            // determine how many bits can be retrieved from this cell
            nbits = Math.min(n, 7 - cellOffset);

            // make an all-set bitmask with length of nbits
            mask = (1 << nbits) - 1;

            mask <<= cellOffset;
            bits = this.arr[cell] & mask;
            bits >>= cellOffset;

            value |= bits << valueOffset;

            // prepare for next iteration
            n -= nbits;
            cellOffset = 0;
            cell++;
            valueOffset += nbits;
        }
        return value;
    }

    , toArrayBuffer: function () {
        // TODO: handle CELLSIZE > 8
        var buf = new ArrayBuffer(this.arr.length);
        var arr = new Uint8Array(buf);
        var i;

        for (i = 0; i < this.arr.length; i++) {
            arr[i] = this.arr[i];
        }
        return arr;
    }

    , fromArrayBuffer: function (buffer) {
        this.arr = [];
        var i;
        for (i = 0; i < buffer.length; i++) {
            this.arr[i] = buffer[i];
        }
    }

    , serialize: function () {
        var i, result = "";
        for (i = 0; i < this.arr.length; i++) {
            result += String.fromCharCode(this.arr[i]);
        }
        return result;
    }

    /**
     * @brief read an unsigned integer consuming the specified number of bits
     */
    , readUInt: function (bits) {
        var result = this.getBits(this._index, bits);
        this._index += bits;
        return result;
    }

    /**
     * @brief write an unsigned integer using the specified number of bits
     */
    , writeUInt: function (value, bits) {
        this.setBits(this._index, bits, value);
        this._index += bits;
    }

    /**
     * @brief read a signed integer consuming the specified number of bits
     */
    , readSInt: function (bits) {
        var result = this.getBits(this._index, bits);
        this._index += bits;
        result *= this.getBits(this._index, 1) ? -1 : 1;
        this._index++;
        return result;
    }

    /**
     * @brief write a signed integer using the specified number of bits
     */
    , writeSInt: function (value, bits) {
        this.setBits(this._index, bits, Math.abs(value));
        this._index += bits;
        this.setBits(this._index, 1, value < 0);
        this._index++;
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
        description._target = obj;
        obj.serialize(description);
        return description._target;
    }
};

Bitstream.deserialize = function (str) {
    var chars = [];
    var i;
    for (i = 0; i < str.length; i++) {
        chars.push(str.charCodeAt(i));
    }
    var bm = new Bitstream (chars);
    return bm;
};

module.exports = Bitstream;

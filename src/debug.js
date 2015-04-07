var Bitstream = require('./bitstream');
var Connection = require('./connection');
var InDescription = require('./in_description');
var OutDescription = require('./out_description');

function Debug() {
    this.level = 0;
}

Debug.prototype = {
    _wrapWithPushPop: function (obj, k) {
        var that = this;
        var f = obj[k];
        obj[k] = function () {
            that.push(k);
            f.apply(this, arguments);
            that.pop();
        };
    },

    _wrapWriter: function (obj, k) {
        var that = this;
        var f = obj[k];
        obj[k] = function (propertyName) {
            that.print(k + ': ' + propertyName.toString());
            f.apply(this, arguments);
        };
    },
    _wrapReader: function (obj, k) {
        var that = this;
        var f = obj[k];
        obj[k] = function () {
            var result = f.apply(this, arguments);
            that.print(k + ': ' + result.toString());
            return result;
        };
    },
    debugMode: function () {
        var that = this;
        var k;
        var f = Connection.prototype.process;
        Connection.prototype.process = function () {
            that.print("\n");
            return f.apply(this, arguments);
        };

        /*
         * This works by traversing and monkey-patching a few classes to
         * wrap relevant functions with instrumentation to format and
         * print information. We use some IIFE magic to give each stub a
         * "sealed" reference to k and the "real" function being wrapped.
         */
        for (k in Connection.prototype) {
            if (typeof Connection.prototype[k] === 'function' && k.indexOf('pack') >= 0) {
                this._wrapWithPushPop(Connection.prototype, k);
            }
        }

        for (k in InDescription.prototype) {
            if (typeof InDescription.prototype[k] === 'function') {
                this._wrapWithPushPop(InDescription.prototype, k);
            }
        }

        for (k in OutDescription.prototype) {
            if (typeof OutDescription.prototype[k] === 'function') {
                this._wrapWithPushPop(OutDescription.prototype, k);
            }
        }

        for (k in Bitstream.prototype) {
            if (typeof Bitstream.prototype[k] === 'function') {
                if (k.indexOf('write') >= 0) {
                    this._wrapWriter(Bitstream.prototype, k);
                }
                if (k.indexOf('read') >= 0) {
                    this._wrapReader(Bitstream.prototype, k);
                }
            }
        }
    },
    print: function (str) {
        var i, prefix = '';
        for (i = 0; i < this.level; i++) {
            prefix += '  ';
        }
        console.log(prefix + str);
    },
    push: function (str) {
        this.print(str + ': ');
        this.level += 1;
    },
    pop: function () {
        this.level -= 1;
    }
};

module.exports = new Debug();
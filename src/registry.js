var Rpc = require('./rpc');

/**
 * Manages the registration of classes for consistent
 * serialization/unserialization
 * @class Registry
 */
function Registry() {
    // hash <-> klass
    this.klassToHash = {};
    this.hashToKlass = {};

    // hash <-> RPC
    this.rpcToHash = {};
    this.hashToRpc = {};

    // objects by serial number
    this.objects = {};
    this.nextSerialNumber = 1;
}

Registry.prototype = {
    constructor: Registry
    /**
     * return a unique hash from a klass suitable for entering into the
     * registry arrays
     * @method hash
     */
    , hash: function(klass) {
        var result = 0, name = klass.prototype.constructor.name;
        for (var i = 0; i < name.length; i++) {
            // TODO: just how unique is this hash?
            result ^= name.charCodeAt(i);
        }
        return result;
    }
    /**
     * register a klass
     * @method addClass
     */
    , addClass: function(klass) {
        var hash = this.hash(klass);
        if (this.hashToKlass[hash] !== undefined) {
            throw "Invalid attempt to redefine class " + klass.name + " with hash " + hash;
        }

        // build the rpc registry for this klass
        klass.wabiRpcs = { };
        for (prop in klass.prototype) {
            var rpc;
            rpc = klass.prototype[prop];
            // search for a function property starting with "rpc" and not
            // ending with "Args"
            if (typeof rpc === "function" &&
                prop.indexOf("rpc") === 0 &&
                prop.indexOf("Args") !== prop.length - 4
            ) {
                // find the Args function (for rpcFoo this would be
                // rpcFooArgs)
                var args = klass.prototype[prop + "Args"];
                if (typeof args !== "function") {
                    throw "No matching args function \"" + prop + "Args\" found for RPC \"" + prop + "\"";
                }

                rpc.wabiArgs = args;
                klass.wabiRpcs[this.hash(rpc)] = rpc;

                klass[prop] = function() {
                    // TODO: replace original rpcFoo with a function to
                    // pack the RPC into the appropriate bitstream(s)
                }
            }
        }

        this.klassToHash[klass] = hash;
        this.hashToKlass[hash] = klass;
    }
    /**
     * register a global RPC
     * @method addRpc
     */
    , addRpc: function(fn, serialize) {
        var hash = this.hash(fn);
        var klass;
        if (hash in this.hashToRpc) {
            throw new Error("Invalid attempt to redefine RPC " + fn.name + " with hash " + hash);
        }

        var rpc = new Rpc(fn, klass, serialize);

        // normal hash <-> rpc mapping
        this.rpcToHash[rpc] = hash;
        this.hashToRpc[hash] = rpc;
    }
    /**
     * register an instance of a klass
     * @method addObject
     */
    , addObject: function(obj, serial) {
        obj.wabiSerialNumber = serial || this.nextSerialNumber;
        this.nextSerialNumber += 1;
        this.objects[obj.wabiSerialNumber] = obj;
    }
    /**
     * get an instance of a klass by serial number
     * @method getObject
     */
    , getObject: function(serial) {
        return this.objects[serial];
    }
    /**
     * get the function/constructor/klass represented by the given hash
     * @method getClass
     */
    , getClass: function(hash) {
        return this.hashToKlass[hash];
    }
    /**
     * get the RPC function associated with the hash
     * @method getRpc
     */
    , getRpc: function(hash) {
        return this.hashToRpc[hash];
    }
}

module.exports = Registry;

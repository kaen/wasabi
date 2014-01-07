var Bitstream = require('./bitstream');
var Connection = require('./connection');
var Group = require('./group');
var Registry = require('./registry');
var Rpc = require('./rpc');
var WasabiError = require('./wasabi_error');
var events = require('events');

function _isEmpty(val) {
    var key;
    for (key in val) {
        if (val.hasOwnProperty(key)) {
            return false;
        }
    }

    return true;
}

/**
 * Named and exported function that would otherwise be an IIFE. Used to
 * instantiate a second Wasabi module for use in tests (to simulate a remote
 * client)
 * @method makeWasabi
 * @static
 */

function makeWasabi() {
    var iota; // for enums

    // packet control constants
    iota = 0xFFFF;
    var WSB_SEPARATOR = iota;
    var WSB_SECTION_GHOSTS = --iota;
    var WSB_SECTION_REMOVED_GHOSTS = --iota;
    var WSB_SECTION_UPDATES = --iota;
    var WSB_SECTION_RPC = --iota;
    var WSB_PACKET_STOP = --iota;

    /**
     * Facade class for interacting with Wasabi.
     *
     * Note that Wasabi implements the Node.js `events.EventEmitter` interface
     * for event handling, allowing use of `on`, `once`, `removeListener` and
     * friends. See the related [Node.js events.EventEmitter docs](http://nodejs.org/api/events.html#events_class_events_eventemitter) for
     * event handling methods.
     *
     * @class Wasabi
     */
    var Wasabi = {
        Bitstream: Bitstream,
        Connection: Connection,
        Registry: Registry,
        Rpc: Rpc,

        makeWasabi: makeWasabi,

        servers: [],
        clients: [],
        _rpcQueue: [],
        _groups: {},

        /**
         * Register a class with Wasabi, allowing it to transmit instances of
         * this class through a Connection
         * @method addClass
         * @param {Function} klass The constructor of the class to add
         */
        addClass: function (klass) {
            this.registry.addClass(klass, this);
        },

        /**
         * Register an instance of a klass, which can then be sent to
         * connected clients as needed (based on the results of their
         * `scopeCallback`s).
         *
         * *Note: This method should only be called manually on
         * authoritative peers (i.e. server-side).* Wasabi clients will
         * automatically add instances to the Registry when their ghosts
         * are unpacked
         * @method addObject
         * @param {NetObject} obj The object to add to the registry
         * @param {Number} serial The serial number to assign to this object. If
         * falsy, the nextSerialNumber will be used
         */
        addObject: function (obj) {
            this.registry.addObject(obj);
            obj.wsbInstance = this;
        },

        /**
         * Unregister an instance of a klass
         * @method removeObject
         * @param {NetObject|Number} arg Either a NetObject or a serial number
         *     to be removed from the registry
         */
        removeObject: function (arg) {
            var k;
            this.registry.removeObject(arg);

            // remove object from all groups
            for (k in this._groups) {
                if (this._groups.hasOwnProperty(k)) {
                    this._groups[k].removeObject(arg);
                }
            }
        },

        /**
         * Create an RPC from the supplied procedure and serialize functions.
         * @method mkRpc
         * @param {Function} fn The local function to call when the RPC is
         *     invoked on a remote host
         * @param {Function} opt_serialize An optional serialize function
         *     describing the arguments used by this RPC
         * @return {Function} The function you should call remotely to invoke
         *     the RPC on a connection
         */
        mkRpc: function (fn, opt_serialize) {
            return this.registry.mkRpc(false, fn, opt_serialize, this);
        },

        /**
         * Attach to a server connected through the socket object
         * @method addServer
         * @param {Socket} sock The socket object used to communicate with the
         *     new server
         * @return {Connection} The newly created Connection object
         */
        addServer: function (sock) {
            var conn = new Wasabi.Connection(sock, true, false);
            this.servers.push(conn);
            return conn;
        },

        /**
         * Remove a server by its socket object. `sock` must be strictly equal
         * (`===`) to the original socket.
         * @method removeServer
         * @param {Socket} sock The socket object originally passed to addServer
         */
        removeServer: function (sock) {
            var i;
            for (i = 0; i < this.servers.length; i++) {
                if (this.servers[i]._socket === sock) {
                    this.servers.splice(i, 1);
                    return;
                }
            }
        },

        /**
         * Attach a client connected through the given socket object. Currently
         * this must be a WebSocket or socket.io socket, or something that is
         * API compatible (i.e. has an `onmessage` callback and a `send`
         * method).
         * @method addClient
         * @param {Socket} client The socket object used to communicate with the
         *     new client
         * @param {Function} scopeCallback See {{#crossLink
         *     "Connection"}}{{/crossLink}}
         * @return {Connection} The newly created Connection object
         */
        addClient: function (client, scopeCallback) {
            var conn = new Wasabi.Connection(client, false, true, scopeCallback);
            this.clients.push(conn);
            return conn;
        },

        /**
         * Remove a client by its socket object. `sock` must be strictly equal
         * (`===`) to the original socket.
         * @method removeClient
         * @param {Socket} sock The socket object originally passed to addClient
         */
        removeClient: function (sock) {
            var i;
            for (i = 0; i < this.clients.length; i++) {
                if (this.clients[i]._socket === sock) {
                    this.clients.splice(i, 1);
                    return;
                }
            }
        },

        /**
         * Process the incoming and outgoing data for all connected clients and
         * servers. This is typically called in your game's update loop
         * @method processConnections
         */
        processConnections: function () {
            var k;

            // process server connections
            for (k in this.servers) {
                if (this.servers.hasOwnProperty(k)) {
                    this._processConnection(this.servers[k]);
                }
            }

            // process client connections
            for (k in this.clients) {
                if (this.clients.hasOwnProperty(k)) {
                    this._processConnection(this.clients[k]);
                }
            }
        },

        /**
         * Create a new visibility group
         * @method createGroup
         * @return {Group} The new group
         */
        createGroup: function () {
            var group = new Group(this);
            this._groups[group._id] = group;
            return group;
        },

        /**
         * Destroy a visibility group. This removes the group from all
         * connections as well as the list of all groups known to Wasbi.
         *
         * Removes `group`
         * @method destroyGroup
         * @param {Group} group The group to destroy
         */
        destroyGroup: function (group) {
            var k;
            // remove group from all connections
            for (k in this.clients) {
                if (this.clients.hasOwnProperty(k)) {
                    this.clients[k].removeGroup(group);
                }
            }

            // release group from the master group list
            delete this._groups[group._id];
        },

        /**
         * Packs update data for `obj` into `bs`
         * @method _packUpdate
         * @param {Object} obj The object to pack
         * @param {BitStream} bs The bitstream to pack into
         * @param {Object} discoveredObjects A hash of serial numbers ->
         *     subobject references to update when a subobject is discovered
         * @private
         */
        _packUpdate: function (obj, bs, discoveredObjects) {
            bs.writeUInt(obj.wsbSerialNumber, 16);
            bs.pack(obj, undefined, discoveredObjects);
        },

        /**
         * Unpacks update data from `bs`
         * @method _unpackUpdate
         * @param {BitStream} bs The bitstream to unpack from
         * @private
         */
        _unpackUpdate: function (bs) {
            var serial = bs.readUInt(16);
            var obj = this.registry.getObject(serial);
            if (!obj) {
                throw new WasabiError('Received update for unknown object ' + serial);
            }
            bs.unpack(obj, undefined, this);

            /**
             * Fired client-side when a ghost (the remote counterpart) of an
             * object is created. This occurs when the scope callback for this
             * client (on the server) returns an object when it did not
             * previously.
             *
             * The `obj` will be a newly created instance of the class every
             * time this event is emitted, even when subsequent emissions refer
             * to the same server-side instance. That is, Wasabi created a brand
             * new object every time it creates a ghost.
             *
             * This event is emitted only after the data has received its
             * initial data.
             *
             * Note that this event can be emitted multiple times per object, if
             * object comes in and out of scope.
             *
             * @event clientGhostCreate
             * @param {Object} obj The newly created ghost
             */
            if (obj.wsbJustGhosted) {
                this.emit('clientGhostCreate', obj);
                obj.wsbJustGhosted = false;
            }
            return obj;
        },

        /**
         * Packs data needed to instantiate a replicated version of obj
         * @method _packGhost
         * @param {Object} obj The object to pack
         * @param {BitStream} bs The bitstream to pack into
         * @private
         */
        _packGhost: function (obj, bs) {
            bs.writeUInt(this.registry.hash(obj.constructor), 16);
            bs.writeUInt(obj.wsbSerialNumber, 16);
        },

        /**
         * Unpacks a newly replicated object from Bitstream
         * @method _unpackGhost
         * @param {Bitstream} bs The target bitstream
         * @private
         */
        _unpackGhost: function (bs) {
            var hash = bs.readUInt(16);
            var T = this.registry.getClass(hash);
            var serial = bs.readUInt(16);
            var obj;
            if (!T) {
                throw new WasabiError('Received ghost for unknown class with hash ' + hash);
            }

            obj = new T();
            obj.wsbInstance = this;
            obj.wsbIsGhost = true;
            obj.wsbJustGhosted = true;
            this.registry.addObject(obj, serial);
            return obj;
        },

        /**
         * Packs ghosts for needed objects into `bs`
         * @method _packGhosts
         * @private
         * @param {Array} objects An Array or map of objects to pack ghosts for
         * @param {Bitstream} bs The target Bitstream
         */
        _packGhosts: function (objects, bs) {
            var i;
            var obj;
            for (i in objects) {
                if (objects.hasOwnProperty(i)) {
                    obj = objects[i];
                    this._packGhost(obj, bs);
                }
            }

            bs.writeUInt(WSB_SEPARATOR, 16);
        },

        /**
         * Unpack all needed ghosts from `bs`
         * @method _unpackGhosts
         * @private
         * @param {Bitstream} bs The source Bitstream
         */
        _unpackGhosts: function (bs) {
            while (bs.peekUInt(16) !== WSB_SEPARATOR) {
                this._unpackGhost(bs);
            }

            // burn off the separator
            bs.readUInt(16);
        },

        /**
         * Packs removed ghosts for `objects` into `bs`
         * @method _packRemovedGhosts
         * @private
         * @param {Object} objects An Array or map of objects to remove
         * @param {Bitstream} bs The target Bitstream
         */
        _packRemovedGhosts: function (objects, bs) {
            var k;
            var obj;
            for (k in objects) {
                if (objects.hasOwnProperty(k)) {
                    obj = objects[k];
                    bs.writeUInt(obj.wsbSerialNumber, 16);
                }
            }

            bs.writeUInt(WSB_SEPARATOR, 16);
        },

        /**
         * Unpack all removed ghosts from bs. An object with its ghost unpacked
         * in this way will be removed from the local Wasabi's registry
         * @method _unpackRemovedGhosts
         * @private
         * @param {Bitstream} bs The source Bitstream
         */
        _unpackRemovedGhosts: function (bs) {
            var serial;
            var obj;
            while (bs.peekUInt(16) !== WSB_SEPARATOR) {
                serial = bs.readUInt(16);
                obj = this.registry.getObject(serial);


                /**
                 * Fired client-side when a ghost (the remote counterpart) of an
                 * object is about to be destroyed. This occurs when the scope
                 * callback for this client (on the server) does not return the
                 * object after it did previously.
                 *
                 * Although Wasabi can not acutally "destroy" the object (since
                 * JavaScript has no destructors), the particular instance will
                 * never be referred to be Wasabi again.
                 *
                 * Note that this event can be emitted multiple times per
                 * object, if object comes in and out of scope.
                 *
                 * @event clientGhostDestroy
                 * @param {Object} obj The ghost which is about to be destroyed
                 */
                this.emit('clientGhostDestroy', obj);

                this.removeObject(serial);
            }

            // burn off the separator
            bs.readUInt(16);
        },

        /**
         * Pack the given list of object update data into bs
         * @method _packUpdates
         * @private
         * @param {Object} list An Array or map of objects to pack updates for
         * @param {Bitstream} bs The target Bitstream
         * @param {Object} discoveredObjects A hash of serial numbers ->
         *     subobject references to update when a subobject is discovered
         */
        _packUpdates: function (list, bs, discoveredObjects) {
            var k;
            for (k in list) {
                if (list.hasOwnProperty(k)) {
                    this._packUpdate(list[k], bs, discoveredObjects);
                }
            }

            // because _packUpdates can be called multiple times, no separator
            // is written in the function. It must instead be written during the
            // processConnections call
        },

        /**
         * Unpack the given list of objects (with update data) from bs
         * @method _unpackUpdates
         * @private
         * @param {Bitstream} bs The source Bitstream
         */
        _unpackUpdates: function (bs) {
            var list = [];
            var obj;
            while (bs.peekUInt(16) !== WSB_SEPARATOR) {
                obj = this._unpackUpdate(bs);
                list.push(obj);
            }

            // burn off the separator
            bs.readUInt(16);

            return list;
        },

        /**
         * Pack an RPC invocation to the appropriate connections
         * @method _invokeRpc
         * @private
         * @param {Rpc} rpc the rpc to invoke
         * @param {NetObject} obj the obj to use as the context the invocation,
         *     or false for static invocations
         * @param {Array} args the arguments to the rpc, followed by an optional
         *     list of connections to emit the invocation to. If no connections
         *     are specified, the invocation is emitted to all connections
         */
        _invokeRpc: function (rpc, obj, args) {
            var i;
            var k;
            var invocation;

            // Extract connection list from supplied args
            var conns = args.splice(rpc._fn.length, args.length - rpc._fn.length);

            // Note that RPCs expect exactly the number of arguments specified
            // in the original function's definition, so any arguments passed
            // after that must be Connections to send the invocation on
            for (i = 0; i < conns.length; i++) {
                if (!(conns[i] instanceof Connection)) {
                    throw new WasabiError('Expected connection but got ' + conns[i] + '. Did you pass too many arguments to ' + rpc._fn.wasabiFnName + '?');
                }
            }

            // check for argument underflow
            if (args.length < rpc._fn.length) {
                throw new WasabiError('Too few arguments passed to ' + rpc._fn.wasabiFnName);
            }

            // if no Connections are specified, send the invocation to either
            // servers, clients, or both, depending on the RPC's definition (see
            // the Rpc constructor for details)
            if (conns.length === 0) {
                // process server connections
                if (rpc._toServer) {
                    for (k in this.servers) {
                        if (this.servers.hasOwnProperty(k)) {
                            conns.push(this.servers[k]);
                        }
                    }
                }

                // process client connections
                if (rpc._toClient) {
                    for (k in this.clients) {
                        if (this.clients.hasOwnProperty(k)) {
                            conns.push(this.clients[k]);
                        }
                    }
                }
            }

            // add the invocation to the proper connections' rpc queues
            for (i = 0; i < conns.length; i++) {
                invocation = {
                    rpc: rpc,
                    args: args,
                    obj: obj,
                    bs: conns[i]._sendBitstream
                };
                conns[i]._rpcQueue.push(invocation);
            }
        },

        /**
         * Pack all RPC invocations in the specified `Connection`'s queue.
         * @method _packRpcs
         * @private
         * @param {Connection} conn The connection to pack RPC invocations for
         * @param {Bitstream} bs The target Bitstream
         * @param {Object} discoveredObjects A hash of serial numbers ->
         *     subobject references to update when a subobject is discovered
         */
        _packRpcs: function (conn, bs, discoveredObjects) {
            var i;
            var invocation;
            for (i = 0; i < conn._rpcQueue.length; i++) {
                invocation = conn._rpcQueue[i];
                this._packRpc(invocation.rpc, invocation.args, invocation.obj, bs, discoveredObjects);
            }

            // write a separator
            bs.writeUInt(WSB_SEPARATOR, 16);
        },

        /**
         * Unpack RPC invocations from bs
         * @method _unpackRpcs
         * @private
         * @param {Bitstream} bs The target Bitstream
         */
        _unpackRpcs: function (bs, conn) {
            while (bs.peekUInt(16) !== WSB_SEPARATOR) {
                this._unpackRpc(bs, conn);
            }

            // burn off the separator
            bs.readUInt(16);
        },

        /**
         * Pack a call to a registered RP and the supplied arguments into bs
         * @method _packRpc
         * @private
         * @param {Rpc} rpc The RPC to pack
         * @param {Array} args The arguments to be serialized into this
         *     invocation
         * @param {NetObject} obj The NetObject to apply the RPC to (or falsy
         *     for "static" RPC invocation
         * @param {Bitstream} bs The target Bitstream
         * @param {Object} discoveredObjects A hash of serial numbers ->
         *     subobject references to update when a subobject is discovered
         */
        _packRpc: function (rpc, args, obj, bs, discoveredObjects) {
            rpc._populateKeys(args);
            bs.writeUInt(obj ? obj.wsbSerialNumber : 0, 16);
            bs.writeUInt(this.registry.hash(rpc._klass, rpc._fn), 16);
            args.serialize = rpc._serialize;
            bs.pack(args, discoveredObjects);
        },

        /**
         * Unpack and execute a call to a registered RP using the supplied
         * arguments from bs
         * @method _unpackRpc
         * @private
         * @param {Bitstream} bs The source Bitstream
         * @param {Connection} conn The connection this RPC was invoked from
         */
        _unpackRpc: function (bs, conn) {
            var serialNumber = bs.readUInt(16);
            var hash = bs.readUInt(16);
            var obj = this.registry.getObject(serialNumber);
            var rpc;
            var args;

            // look up the Rpc by the hash
            rpc = this.registry.getRpc(hash);
            if (!rpc) {
                throw new WasabiError('Unknown RPC with hash ' + hash);
            }

            // unpack the arguments
            args = [];
            args.serialize = rpc._serialize;
            bs.unpack(args);
            rpc._populateIndexes(args);

            // add the connection this invocation was received through to the
            // argument list
            args.push(conn);

            if (serialNumber && !obj) {
                // a serial number was specified, but the object wasn't found
                // this can happen in normal operation if a server removes an
                // object in the same frame that a client calls an RPC on it
                return;
            }

            // invoke the real function
            rpc._fn.apply(obj, args);
        },

        /**
         * Returns a clone of the registry's object table. used as a fallback
         * when no _scopeCallback is specified for a connection
         * @method _getAllObjects
         * @private
         */
        _getAllObjects: function () {
            var result = {};
            var k;
            for (k in this.registry._objects) {
                if (this.registry._objects.hasOwnProperty(k)) {
                    result[k] = this.registry._objects[k];
                }
            }
            return result;
        },

        /**
         * Receive, process, and transmit data as needed for this connection
         * @method _processConnection
         * @private
         */
        _processConnection: function (conn) {
            var k;
            var data;
            var newObjects;
            var newlyVisibleObjects;
            var newlyInvisibleObjects;
            var oldObjects;
            var discoveredObjects;
            var section;
            var updateStream;
            var rpcStream;
            var ghostStream;
            var ghostRemovalStream;
            var subobjects;

            debugger;

            // connections with ghostTo set (i.e. clients)
            if (conn._ghostTo) {

                // get list of objects which are visible this frame
                if (conn._groups) {
                    // use visibility groups if there is a list of them
                    newObjects = conn.getObjectsInGroups();
                } else if (conn._scopeCallback) {
                    // otherwise look for a scope callback
                    newObjects = conn._scopeCallback();
                } else {
                    // if neither is set, default to sending all objects
                    newObjects = this._getAllObjects();
                }

                /**
                 * Because objects can contain references to other managed
                 * objects, we must add these subobjects to the list of visible
                 * objects to ensure that a ghost is available on the remote end
                 * during unpacking.
                 *
                 * Additionally, RPC invocations can contain references, so they
                 * must be traversed as well.
                 *
                 * Once we have an initial list of *discovered* objects, we must
                 * descend in to that set, to see if it contains more
                 * references. We repeat this process on each set of discovered
                 * objects until no more objects are discovered.
                 *
                 * Cyclical references are handled by using newObjects as a
                 * history of objects which already have ghosts packed.
                 */

                ghostStream = new Bitstream();
                updateStream = new Bitstream();
                rpcStream = new Bitstream();
                ghostRemovalStream = new Bitstream();

                // pack RPC invocations, put discovered subobjects into the
                // newObjects list to ensure that a ghost is available
                this._packRpcs(conn, rpcStream, newObjects);
                conn._rpcQueue = [];

                discoveredObjects = newObjects;
                while (!_isEmpty(discoveredObjects)) {
                    subobjects = {};
                    // pack updates for all objects that were just discovered
                    this._packUpdates(discoveredObjects, updateStream, subobjects);

                    // ignore known objects and create ghosts for objects as needed
                    for (k in subobjects) {
                        if (subobjects.hasOwnProperty(k)) {
                            if (newObjects.hasOwnProperty(k)) {
                                // when k exists in both, the object has already
                                // been discovered previously
                                delete subobjects[k];
                            } else {
                                // otherwise, it was just discovered in the last
                                // pass, so it must be added to newObjects to
                                // ensure that a ghost exists on the remote end
                                newObjects[k] = subobjects[k];
                            }
                        }
                    }

                    discoveredObjects = subobjects;
                }
                updateStream.writeUInt(WSB_SEPARATOR, 16);

                // list of objects which were visible last frame
                oldObjects = conn._visibleObjects;

                // an object in newObjects, but not in oldObjects must be newly
                // visible this frame
                newlyVisibleObjects = {};
                for (k in newObjects) {
                    if (newObjects.hasOwnProperty(k) && oldObjects[k] === undefined) {
                        newlyVisibleObjects[k] = newObjects[k];
                    }
                }
                // an object in oldObjects, but not in newObjects must be newly
                // invisible this frame
                newlyInvisibleObjects = {};
                for (k in oldObjects) {
                    if (oldObjects.hasOwnProperty(k) && newObjects[k] === undefined) {
                        newlyInvisibleObjects[k] = oldObjects[k];
                    }
                }

                // pack ghosts for newly visible objects
                this._packGhosts(newlyVisibleObjects, ghostStream);

                // pack ghost removals for newly invisible objects
                this._packRemovedGhosts(newlyInvisibleObjects, ghostRemovalStream);

                conn._sendBitstream.writeUInt(WSB_SECTION_GHOSTS, 16);
                conn._sendBitstream.append(ghostStream);

                conn._sendBitstream.writeUInt(WSB_SECTION_UPDATES, 16);
                conn._sendBitstream.append(updateStream);

                conn._sendBitstream.writeUInt(WSB_SECTION_RPC, 16);
                conn._sendBitstream.append(rpcStream);

                conn._sendBitstream.writeUInt(WSB_SECTION_REMOVED_GHOSTS, 16);
                conn._sendBitstream.append(ghostRemovalStream);

                // set the connection's visible object collection
                conn._visibleObjects = newObjects;

            } else {

                // pack just the RPC invocations if we don't ghost to this connection
                rpcStream = new Bitstream();
                this._packRpcs(conn, rpcStream);

                conn._sendBitstream.writeUInt(WSB_SECTION_RPC, 16);
                conn._sendBitstream.append(rpcStream);

                conn._rpcQueue = [];
            }


            // write a packet terminator
            conn._sendBitstream.writeUInt(WSB_PACKET_STOP, 16);

            // now we'll process the incoming data on this connection
            conn._receiveBitstream._index = 0;

            /**
             * Fired before Wasabi processes incoming data. Useful for
             * measuring data transmission statistics.
             *
             * Note that this event fires during `processConnections`, and is
             * not meant to replace the `onmessage` handler for typical
             * WebSockets or socket.io sockets.
             *
             * @event receive
             * @param {Connection} conn The connection being processed
             * @param {String} data The data being received over the connection
             */
            this.emit('receive', conn, conn._receiveBitstream.toChars());
            while (conn._receiveBitstream.bitsLeft() > 0) {
                section = conn._receiveBitstream.readUInt(16);
                if (section !== WSB_PACKET_STOP) {
                    // invoke the appropriate unpack function via the
                    // _sectionMap
                    conn._receiveBitstream.align();
                    this._sectionMap[section].call(this, conn._receiveBitstream, conn);
                }

                conn._receiveBitstream.align();
            }

            /**
             * Fired before Wasabi sends data over a connection. Useful for
             * measuring data transmission statistics.
             *
             * @event send
             * @param {Connection} conn The connection being processed
             * @param {String} data The data being sent over the connection
             */
            data = conn._sendBitstream.toChars();
            this.emit('send', conn, data);
            try {
                // send the actual data
                conn._socket.send(data);
            } catch (e) {

                /**
                 * Fired when Wasabi receives an error while sending data over a
                 * connection. Note that Wasabi will remove the connection from
                 * its list of clients and servers immediately after emitting
                 * this event.
                 *
                 * An event is used in order to give user code a chance to react
                 * to the error without interupting the processing of other
                 * connections within the same `processConnections` call.
                 *
                 * @event sendError
                 * @param {Connection} conn The connection which generated the
                 *     error.
                 * @param {Error} e The original error
                 */
                this.emit('sendError', conn, e);
                this.removeClient(conn._socket);
                this.removeServer(conn._socket);
            }

            // clear the bit streams
            conn._sendBitstream.empty();
            conn._receiveBitstream.empty();
        }
    };

    // a simple section marker -> method map
    Wasabi._sectionMap = {};
    Wasabi._sectionMap[WSB_SECTION_GHOSTS] = Wasabi._unpackGhosts;
    Wasabi._sectionMap[WSB_SECTION_REMOVED_GHOSTS] = Wasabi._unpackRemovedGhosts;
    Wasabi._sectionMap[WSB_SECTION_UPDATES] = Wasabi._unpackUpdates;
    Wasabi._sectionMap[WSB_SECTION_RPC] = Wasabi._unpackRpcs;

    Wasabi.registry = new Registry();

    // mixin a Node event emitter
    events.EventEmitter.call(Wasabi);
    var k;
    for (k in events.EventEmitter.prototype) {
        if (events.EventEmitter.prototype.hasOwnProperty(k)) {
            Wasabi[k] = events.EventEmitter.prototype[k];
        }
    }

    return Wasabi;
}

var Wasabi = makeWasabi();

module.exports = Wasabi;
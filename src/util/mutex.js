import { EventEmitter } from 'events';

module.exports = {
    createResourceMutex: () => {
        let mutex = {};
        mutex.resources = {};

        mutex.__createResource = (id) => {
            if (mutex.__hasResource(id)) {
                return mutex.resources[id];
            }

            mutex.resources[id] = {
                __emitter: new EventEmitter(),
                locked: false,
                queue: []
            };

            mutex.resources[id].__emitter.setMaxListeners(1024);

            return mutex.resources[id];
        };

        mutex.__hasResource = (id) => {
            return !!mutex.resources[id];
        };

        mutex.__getResource = (id) => {
            if (mutex.__hasResource(id)) {
                return mutex.resources[id];
            } else {
                return mutex.__createResource(id);
            }
        };

        mutex.lock = async (id) => {
            let resource = mutex.__getResource(id);

            if (!resource.locked) {
                resource.locked = true;
                return;
            } else {
                return new Promise(resolve => {
                    resource.queue.push(resolve);
                });
            }
        };

        mutex.unlock = async (id) => {
            let resource = mutex.__getResource(id);

            if (resource.queue.length === 0) {
                resource.__emitter.emit('absolute_unlock');
                resource.locked = false;
            } else {
                resource.queue.shift()();
            }
        };

        mutex.waitForUnlock = async (id) => {
            let resource = mutex.__getResource(id);

            if (!resource.locked) {
                return;
            } else {
                return new Promise(resolve => {
                    resource.__emitter.once('absolute_unlock', resolve);
                });
            }
        };

        mutex.isLocked = (id) => {
            let resource = mutex.__getResource(id);
            return resource.locked;
        };

        return mutex;
    }
}
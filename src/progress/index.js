let progress = {};


module.exports = {
    setStatus: (key, value, type) => {
        progress[key] = {
            value: value,
            type: type
        }
    },
    getStatus: (key) => {
        return progress[key]
    }
}
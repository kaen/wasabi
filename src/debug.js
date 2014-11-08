function Debug() {
    this.level = 0;
}

Debug.prototype = {
    print: function(str) {
        var prefix = '';
        for(var i = 0; i < this.level; i++) {
            prefix += '  ';
        }
        console.log(prefix + str);
    },
    push: function(str) {
        this.print(str + ': ');
        this.level += 1;
    },
    pop: function() {
        this.level -= 1;
    }
};

module.exports = new Debug();
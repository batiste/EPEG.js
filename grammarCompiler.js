var EPEG = require('./EPEG');

var tokens = [
  {key:"tokenTitle", str:"Tokens"},
  {key:"grammarTitle", str:"Grammar"},
  {key:"newLine", reg:/^\n/},
  {key:"function", reg:/^function.*/},
  {key:"name", reg:/^[a-zA-Z]+[a-zA-Z_0-9]*/},
  {key:"w", reg:/^[ |\t]/},
  {key:"regexp", reg:/^\/.*/},
  {key:"string", reg:/^\".*/},
  {key:"specialChar", reg:/^[\?|\*|\+|\!|\:]/},
];

function reflect(params) {
    return params;
}

var grammar = {
  "START": {rules: ["SECTIONS"]},
  "TokenValue": {rules: ["regexp", "string", "function", "tokenTitle", "grammarTitle", "function"]},
  "TokenDef": {rules: ["n:name w+ v:TokenValue newLine+"], hooks:[reflect]},
  "TokenSection": {rules: ["tokenTitle newLine+ td:TokenDef+"], hooks:[reflect]},
  "GrammarValue": {rules: ["name", "w", "specialChar"]},
  "GrammarRule": {rules: ["w+ gv:GrammarValue+ newLine"], hooks:[reflect]},
  "GrammarDef": {rules: ["name:name newLine gr:GrammarRule+ newLine*"], hooks:[reflect]},
  "GrammarSection": {rules: ["grammarTitle newLine+ gd:GrammarDef+"], hooks:[reflect]},
  "SECTIONS": {rules: ["newLine* ts:TokenSection gs:GrammarSection? EOF"]}
};

var backend = {
    'TokenSection': function(node) {
        var str = "", i, tokens = []; 
        for(i=0; i<node.children.td.length; i++) {
            tokens.push(generateCode(node.children.td[i]));
        }
        return "// Tokens\nvar tokens = [\n" + tokens.join(",\n") + "]\n";
    },
    'TokenDef': function(node) {
        return '  {key:"'+node.children.n.value+'", '+generateCode(node.children.v)+"}";
    },
    'regexp': function(node) {
        return "reg: "+node.value;
    },
    'function': function(node) {
        return "fun: "+node.value;
    },
    'string': function(node) {
        return "str: "+node.value;
    },
    'GrammarSection': function(node) {
        var str = "var grammar = {\n", i;
        var grammarDef = [];
        for(i=0; i<node.children.gd.length; i++) {
            grammarDef.push(generateCode(node.children.gd[i]));
        }
        return "// Grammar\nvar grammar = {\n" + grammarDef.join(",\n") + '\n}';
    },
    'GrammarDef': function(node) {
        var rules = [];
        for(i=0; i<node.children.gr.length; i++) {
            rules.push('"' + generateCode(node.children.gr[i]) + '"');
        }
        return '  "' + node.children.name.value + '": {rules: [' + rules.join(', ') + ']}';
    },
    'GrammarRule': function(node) {
        var str = "", i; 
        for(i=0; i<node.children.gv.length; i++) {
            str += generateCode(node.children.gv[i]);
        }
        return str;
    }
};

function generateCode(node) {
  var str;
  if(!node) {
    return;
  }
  if(backend[node.type]) {
    return backend[node.type](node);
  }
  
  if(node.value !== undefined) {
    return node.value;
  }
  
  str = "";
  if(!node.children) {
    return '';
  }
  
  var __keys = Object.keys(node.children);
  for(var __index = 0; __index < __keys.length; __index++) {
    var child = node.children[__keys[__index]];
    str += generateCode(child);
  }
  
  return str;
}

var argv = require('minimist')(process.argv.slice(2));
var files = argv._;
var fs = require('fs');
if(files.length === 0) {
    console.log("pass a filename as parameter");
    return;
}
var content = fs.readFileSync(files[0], "utf8");
var gram = EPEG.compileGrammar(grammar, tokens);
var parsed = gram.parse(content);

if(!parsed.complete) {
    console.log(parsed.hint);
} else {
    var code = generateCode(parsed);
    //console.log(code)
    var vm = require('vm');
    var sandbox = { EPEG: EPEG };
    vm.createContext(sandbox);
    code += "\nvar parser = EPEG.compileGrammar(grammar, tokens);";
    var vmResult = vm.runInContext(code, sandbox);
    console.log(code);
}


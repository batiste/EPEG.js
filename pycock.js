"use strict";


// token are matched in order of declaration
// TODO: add functions
var tokenDef = {
  comment: commentDef,
  function_def: defDef,
  class: /^class /,
  ret: /^return/,
  _if: /^if /,
  _elseif: /^elseif /,
  _else: /^else/,
  r_arrow: /^\-\>/,
  for_loop: /^for /,
  _in: /^in /,
  name: /^[a-zA-Z_$][0-9a-zA-Z_]{0,29}/, // 30 chars max
  math_operators: /^(\+\+|\-\-)/,
  binary_operators: /^(\&\&|\|\||\&|\||<<|\>\>)/,
  comparison: /^(<=|>=|<|>|===|!=|==)/,
  assign: /^(\+=|-=|=|:=)/,
  number: /^[0-9]+\.?[0-9]*/, // only positive for now
  comma: /^\,/,
  dot: /^\./,
  colon: /^\:/,
  open_par: /^\(/,
  close_par: /^\)/,
  open_bra: /^\[/,
  close_bra: /^\]/,
  open_curly: /^\{/,
  close_curly: /^\}/,
  math: /^[-|\+|\*|/|%]/,
  samedent: dent('samedent'),
  dedent: dent('dedent'),
  indent: dent('indent'),
  //newline: /^(\r?\n|$)/,
  W: /^[ ]/,
  string: stringDef,
};

var levelStack = [0];
function currentLevel() {
  return levelStack[levelStack.length - 1];
}

function indentType(l) {
  if(l > currentLevel()) {
    return 'indent';
  }
  if(l < currentLevel()) {
    return 'dedent';
  }
  if(l === currentLevel()) {
    return 'samedent';
  }
}

function dent(dentType) {
  return function _dent(input) {
    var m = input.match(/^\n[ ]*/);
    if(m) {
    var indent = m[0].length - 1;
      if(indentType(indent) === dentType) {
        if(dentType == 'dedent') {
          //var diff = currentLevel() - indent;
          // the last dedent should consume
          levelStack.pop();
          //if(currentLevel() === indent) {
          //  debugger
          //  return m[0];
          //}
          return '';
        }
        if(dentType == 'indent') {
          levelStack.push(indent);
        }
        return m[0];
      }
    }
  };
}


function stringDef(input) {
  if(input.charAt(0) === '"') {
    var i = 1;
    while(input.charAt(i)) {
      var ch = input.charAt(i);
      if(ch === '\\') {
        i++;
      } else if(ch === '"') {
        return input.slice(0, i+1);
      }
      i++;
    }
  }
}

function defDef(input) {
  if(input.indexOf("def(") === 0) {
    return "def";
  }
  if(input.indexOf("def ") === 0) {
    return "def";
  }
}

function commentDef(input) {
  if(input.indexOf("//") === 0) {
    var i = 2;
    while(input.charAt(i)) {
      var ch = input.charAt(i);
      if(ch === '\n') {
        return input.slice(0, i);
      }
      i++;
    }
  }
}

function f_def(params) {
  return [params.fn, params.p, params.b];
}

function lambda_def(params) {
  return [params.fn, params.p, params.b];
}

function else_def(params) {
  return [params.b];
}

function else_if_def(params) {
  return [params.e, params.b];
}

function if_def(params) {
  return [params.e, params.b, params.elif, params.el];
}

function forLoop(params) {
  return [params.k, params.v, params.a, params.b];
}


var grammarDef = {
  "START": {rules:["LINE* EOF"]},
  "LINE": {rules:["STATEMENT samedent+", "STATEMENT !dedent", "comment? samedent"]},
  "STATEMENT": {rules:["ASSIGN", "IF", "FOR", "EXPR", "RETURN", "CLASS"]},
  "VALUE": {rules:["number", "string"]},
  "BLOCK": {rules: ["indent LINE+ dedent"]},
  "CLASS_METHODS": {rules: ["samedent* FUNC_DEF samedent*"]},
  "CLASS": {
    rules: ["class n:name indent m:CLASS_METHODS* dedent"],
    hooks: [function(p){ return [p.n, p.m]; }]
  },
  "FUNC_DEF_PARAMS": {rules:[
      "p1:FUNC_DEF_PARAMS comma W p2:FUNC_DEF_PARAMS",
      "p1:name assign e:EXPR",
      "p1:name",
    ],
  },
  "LAMBDA": {rules:[
      "function_def open_par p:FUNC_DEF_PARAMS? close_par W b:EXPR",
      "function_def W fn:name open_par p:FUNC_DEF_PARAMS? close_par W b:EXPR",
    ],
    hooks: [lambda_def, lambda_def]
  },
  "FUNC_DEF": {rules:[
      "function_def open_par p:FUNC_DEF_PARAMS? close_par b:BLOCK",
      "function_def W fn:name open_par p:FUNC_DEF_PARAMS? close_par b:BLOCK",
    ],
    hooks: [f_def, f_def]
  },
  "ELSE_IF": {rules:["samedent _elseif e:EXPR b:BLOCK"], hooks:[else_if_def]},
  "ELSE": {rules:["samedent _else b:BLOCK"], hooks:[else_def]},
  "IF": {rules:["_if e:EXPR b:BLOCK elif:ELSE_IF* el:ELSE?"], hooks:[if_def]},
  "MATH": {rules:["e1:EXPR W? op:math W? e2:EXPR"]},
  "PATH": {rules:["PATH dot name", "PATH open_bra number close_bra", "name"]},
  "ASSIGN": {rules:["left:EXPR W? op:assign W? right:EXPR"], hooks:[
    function(p){
      return {left:p.left, op:p.op, right:p.right};
    }]
  },
  "FUNC_CALL_PARAMS": {rules:["FUNC_CALL_PARAMS comma W? EXPR", "EXPR"]},
  "FUNC_CALL": {rules:["name open_par FUNC_CALL_PARAMS? close_par"]},

  "FOR": {rules:[
    "for_loop k:name comma W v:name W _in a:name b:BLOCK",
    "for_loop v:name W _in a:name b:BLOCK"],
    hooks: [forLoop, forLoop]
  },

  "COMMA_SEPARATED_EXPR": {rules:[
    "EXPR comma SPACE* COMMA_SEPARATED_EXPR",
    "EXPR"
  ]},

  "ARRAY": {rules:[
    "open_bra SPACE* c:COMMA_SEPARATED_EXPR? SPACE* close_bra dedent?",
  ]},

  "MEMBERS": {rules:[
    "name colon SPACE* EXPR comma SPACE* MEMBERS",
    "name colon SPACE* EXPR"
  ]},

  "OBJECT": {rules:[
    "open_curly SPACE* MEMBERS? SPACE* close_curly dedent?",
  ]},

  "SPACE": {rules:["W", "indent", "dedent", "samedent"]},

  "RETURN": {rules:["ret W EXPR", "ret"]},
  "RIGHT_EXPR": {rules: [
    "math_operators",
    "W? binary_operators W? EXPR",
    "W? comparison W? EXPR",
    "dot EXPR",
    "open_bra EXPR close_bra"
  ]},
  "EXPR": {rules: [
    "MATH",
    "EXPR RIGHT_EXPR",
    "FUNC_CALL",
    "FUNC_DEF",
    "LAMBDA",
    "number",
    "open_par EXPR close_par",
    "string",
    "name",
    "PATH",
    "ARRAY",
    "OBJECT"]},
};

function spacer(n) {
  var out = "";
  for(var i=0; i<n; i++) {
    out += " ";
  }
  return out;
}


var namespaces = [{}];

function generateParams(ps, ns) {
  var str = '';
  if(ps){
    var params = ps.children;
    if(params) {
      params.map(function(p) {
        if(p.type == 'name') {
          ns[p.value] = true;
        }
        if(p.children) {
          str += generateParams(p, ns);
        } else {
          str += p.value;
        }
      });
    }
  }
  return str;
}

var depth = 0;
function sp(mod) {
  if(mod) {
    return spacer(2 * (depth+mod));
  }
  return spacer(2 * depth);
}

var forLoopCount = 1;

var backend = {

  'dedent': function(node) {
    depth = Math.max(0, depth - 1);
    return '';
  },
  'indent': function(node) {
    depth = depth + 1;
    return '\n'+sp();
  },
  'samedent': function(node) {
    return '\n'+sp();
  },
  'CLASS': function(node) {
    var name = node.children[0].value, i;
    var funcs = node.children[1];
    var str = '';
    var constructor = null;
    for(i=0;i<funcs.length; i++) {
      var func_def = funcs[i].children[0];
      var func_name = func_def.children[0].value;
      if(func_name === 'constructor') {
        constructor = func_def;
      } else {
        str += '\n' + sp() + name + '.prototype.' + func_name + ' = ' + generateCode(func_def);
      }
    }

    namespaces.push({});
    var ns = namespaces[namespaces.length -1];

    var params = constructor && constructor.children[1];
    if(params) {
      params = generateCode(params);
    } else {
      params = '';
    }
    var body = constructor && constructor.children[2];
    var cons_str = 'var ' + name + ' = function ' + name + '('+ params + ') {';
    cons_str += '\n'+sp(1)+'if(!(this instanceof '+name+')){ return new '+name+'('+Object.keys(ns).join(',')+');}';
    for(var key in ns) {
      if(ns[key] !== true && ns[key] !== undefined) {
        cons_str += '\n'+sp(1)+'if('+key+' === undefined) {'+key+'='+generateCode(ns[key])+'};';
      }
    }

    if(body) {
      cons_str += generateCode(body);
    }
    cons_str += sp() + '\n}';

    namespaces.pop();
    return cons_str + str;
  },
  'FUNC_DEF': function(node) {
    var name = "";
    namespaces.push({});
    var ns = namespaces[namespaces.length -1];
    if(node.children[0]) {
      name = node.children[0].value;
    }
    var str = "function " + name + "(";
    if(node.children[1]) {
      str += generateCode(node.children[1]);
    }
    str += ') {';
    for(var key in ns) {
      if(ns[key] !== true && ns[key] !== undefined) {
        str += '\n'+sp(1)+'if('+key+' === undefined) {'+key+'='+generateCode(ns[key])+'};';
      }
    }
    if(node.children[2]) {
      str += generateCode(node.children[2]);
    }
    namespaces.pop();
    return str + '\n'+sp()+'}';
  },
  'FUNC_DEF_PARAMS': function(node) {
    var str = "", i;
    var ns = namespaces[namespaces.length -1];
    if(node.children[0].type === 'name') {
      ns[node.children[0].value] = true;
      if(node.children[1] && node.children[1].type === 'assign') {
        ns[node.children[0].value] = node.children[2];
      }
    }
    for(i=0;i<node.children.length; i++) {
      var n = node.children[i];
      if(n.type === 'name' || n.type === 'FUNC_DEF_PARAMS' || n.type === 'comma' || n.type === 'window') {
        str += generateCode(node.children[i]);
      }
    }
    return str;
  },
  'LAMBDA': function(node) {
    var name = "";
    namespaces.push({});
    var ns = namespaces[namespaces.length -1];
    if(node.children[0]) {
      name = node.children[0].value;
    }
    var str = "function " + name + "(";
    if(node.children[1]) {
      str += generateCode(node.children[1], ns);
    }
    str += ') { return ';
    if(node.children[2]) {
      str += generateCode(node.children[2], ns);
    }
    namespaces.pop();
    return str + "; }";
  },
  'ASSIGN': function(node) {
    var prefix = "";
    var op = node.children.op.value;
    var ns = namespaces[namespaces.length -1];
    if(node.children.left.children[0].type === 'name') {
      var ch = node.children.left.children[0];
      if(ns[ch.value] === undefined) {
        if(op == ':=') {
          op = '=';
        } else {
          prefix = 'var ';
        }
        ns[ch.value] = true;
      }
    }
    return prefix+generateCode(node.children.left) + op + generateCode(node.children.right);
  },
  'STATEMENT': function(node) {
    return generateCode(node.children[0]) + ';';
  },
  'IF': function(node) {
    var str = '';
    str = 'if('+generateCode(node.children[0]) + '){' + generateCode(node.children[1]) + '\n'+sp()+'}';
    if(node.children[2]) {
      if(Array.isArray(node.children[2])) {
        for (var i = 0; i < node.children[2].length; i++) {
          str += generateCode(node.children[2][i]);
        }
      } else {
        str += generateCode(node.children[2]);
      }
    }
    if(node.children[3]) {
      str += generateCode(node.children[3]);
    }
    return str;
  },
  'FOR': function(node) {
    var keyIndexName = "_index"+forLoopCount;
    var keyArrayName = "_keys"+forLoopCount;
    forLoopCount++;
    var indexName = false;
    if(node.children[0]) {
      indexName = node.children[0].value;
    }
    var str = 'var '+keyArrayName+' = Object.keys('+node.children[2].value+');\n';
    str += sp() + 'for(var '+keyIndexName+'=0; '+keyIndexName+' < '+keyArrayName+'.length; '+keyIndexName+'++ ) {\n';
    if(indexName) {
      str += sp(1) + 'var ' + indexName + ' = ' + keyArrayName +'[' + keyIndexName + '];\n';
    }
    str += sp(1) + 'var ' + node.children[1].value + ' = ' + node.children[2].value + '[' + keyArrayName +'[' + keyIndexName + ']];';
    str += generateCode(node.children[3]) +'\n'+sp()+'}';
    return str;
  },
  'ELSE_IF': function(node) {
    return ' else if('+generateCode(node.children[0])+') {'+generateCode(node.children[1])+ '\n'+sp()+'}';
  },
  'ELSE': function(node) {
    return ' else {'+generateCode(node.children[0])+ '\n'+sp()+'}';
  },
  'string': function(node) {
    return node.value.replace(/\n/g, "\\\n");
  },
};

function generateCode(node, ns) {
  if(!node) {
    //debugger
  }
  if(backend[node.type]) {
    return backend[node.type](node);
  }
  if(node.value !== undefined) {
    return node.value;
  }
  var str = "", i;
  if(!node.children) {
    return '';
  }
  for(i=0;i<node.children.length; i++) {
    str += generateCode(node.children[i], ns);
  }
  return str;
}

var gram = EPEG.compileGrammar(grammarDef, tokenDef);

function generateModule(input) {
  namespaces = [{}];
  forLoopCount = 1;
  levelStack = [0];
  var ast = gram.parse(input + "\n");
  if(!ast.complete) {
    throw ast.hint;
  }
  return {ast:ast, code:generateCode(ast)};
}

window.pycock = {
  grammar: gram,
  grammarDef: grammarDef,
  tokenDef: tokenDef,
  generateModule: generateModule,
  generateCode: generateCode
};

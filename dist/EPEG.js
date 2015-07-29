!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.EPEG=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/*
  JavaScript implementation of a Packrat Parsers with left Recursion Support
  http://www.vpri.org/pdf/tr2007002_packrat.pdf

  No Indirect Left Recursion yet :-(

  Batiste Bieler 2014
*/
"use strict";

function tokenize(input, gram) {
  var keys = gram.tokenKeys;
  var tokens = gram.tokenMap;
  var stream = [];
  var len = input.length, candidate, i, key, copy = input, lastToken = null;
  var pointer = 0;
  var line = 0;
  var column = 0;

  while(pointer < len) {
    candidate = null;
    for(i=0; i<keys.length; i++) {
      key = keys[i];
      var token = tokens[key], match;
      if(token.func) {
        match = token.func(input, stream);
        if(match !== undefined) {
          candidate = match;
          break;
        }
      } else if(token.reg){
        match = input.match(token.reg);
        if(match !== null) {
          candidate = match[0];
          break;
        }
      } else if(token.str){
        match = input.indexOf(token.str);
        if(match === 0) {
          candidate = token.str;
          break;
        }
      } else {
        throw new Error("Tokenizer error: Invalid token " + key + " without a reg, str or func property");
      }
    }
    if(candidate !== null) {
      lastToken = {type:key, value:candidate, pointer:pointer, line:line+1, column:column+1};
      stream.push(lastToken);
      var line_breaks_count = countLineBreak(candidate);
      line += line_breaks_count;
      if(line_breaks_count > 0) {
        column = 0;
      }
      column += countColumn(candidate);
      pointer += candidate.length;
      input = input.substr(candidate.length);
    } else {
      if(stream.length === 0) {
        throw new Error("Tokenizer error: total match failure");
      }
      if(lastToken)
        lastToken.pointer += lastToken.value.length;
      var msg = errorMsg(copy, stream[stream.length - 1], "Tokenizer error", "No matching token found");
      if(lastToken)
        msg += "\n" + "Before token of type " + lastToken.type + ": " + lastToken.value;
      throw new Error(msg);
    }
  }
  stream.push({type:'EOF', value:""});
  return stream;
}

function countLineBreak(str) {
  var m = str.split(/\n/g);
  return m.length - 1;
}

function countColumn(str) {
  var m = str.split(/\n/g);
  return m[m.length-1].length;
}

function copyToken(stoken, rtoken) {
  var t = {
    type:stoken.type,
    value:stoken.value,
    repeat:rtoken.repeat,
    line:stoken.line,
    column:stoken.column
  };
  if(rtoken.name) {
    t.name = rtoken.name;
  }
  return t;
}

function createParams(tokens) {
  var params = {};
  var j = 0;
  tokens.map(function(i) {
    if(i.name) {
      if(i.repeat == '*' || i.repeat == '+') {
        if(!params[i.name]) {
          params[i.name] = [];
        }
        params[i.name].push(i);
      } else {
        params[i.name] = i;
      }
    }
    params['$'+j] = i;
    j++;
  });
  return params;
}

function growLR(grammar, rule, stream, pos, memo) {
  var sp, result, progress = false;
  var hook = grammar[rule.key].hooks[rule.index];

  while(true) {
    sp = pos;

    result = evalRuleBody(grammar, rule, stream, sp);

    // ensure some progress is made
    if(result === false || result.sp <= memo.sp) {
      return progress;
    }

    result.hook = hook;

    // it's very important to update the memoized value
    // this is actually growing the seed in the memoization
    memo.children = result.children;
    memo.sp = result.sp;
    memo.line = result.line;
    memo.column = result.column;
    memo.start = result.start;
    memo.hooked = result.hooked;
    memo.hook = result.hook;
    progress = result;
  }
  return progress;
}

function memoEval(grammar, rule, stream, pointer) {

  var key = rule.key+';'+pointer+';'+rule.index;

  // avoid infinite recursion
  // This is faster than filter
  var i = stack.length - 1;
  while(i >= 0) {
    if(stack[i][0] == key) {
      return false;
    }
    i = i-1;
  }

  var memo_entry = memoization[rule.key+';'+pointer];
  if(memo_entry !== undefined) {
    return memo_entry;
  }

  stack.push([key, rule]);
  var result = evalRuleBody(grammar, rule, stream, pointer);
  stack.pop();

  return result;
}

function canFail(token, node) {
  if(token.repeat === '*' || token.repeat === '?') {
    return true;
  }
  if(token.repeat === '+' && node.children.length && node.children[node.children.length - 1].type == token.type) {
    return true;
  }
  return false;
}

function canRepeat(token) {
  return token.repeat === '*' || token.repeat === '+';
}

function evalRuleBody(grammar, rule, stream, pointer) {

  var sp = pointer; // stream pointer
  var rp = 0;       // rule pointer
  var j, result;

  var rtoken = rule.tokens[rp];
  var stoken = stream[sp];

  var currentNode = {
    type: rule.key, 
    children:[], 
    start:pointer, 
    name:rule.name, 
    line:stoken.line, 
    column:stoken.column
  };

  while(rtoken && stoken) {

    // Case one: we have a rule we need to develop
    if(grammar[rtoken.type]) {

      var expand_rules = grammar[rtoken.type].rules;
      var hooks = grammar[rtoken.type].hooks;
      result = false;

      var m = memoization[rtoken.type+';'+sp];
      if(m) {
        result = m;
      }

      if(!result) {
        for(j=0; j<expand_rules.length; j++) {
          var r = expand_rules[j], hook = hooks[j];

          result = memoEval(grammar, r, stream, sp);

          if(result) {

            result.hook = hook;

            memoization[r.key+';'+sp] = result;

            if(rtoken.repeat === false) {
              var n_result = growLR(grammar, rule, stream, sp, result);
              if(n_result !== false) {
                return n_result;
              }
            }
            break;
          }
        }
      }

      if(result) {
        sp = result.sp;
        currentNode.children.push({
            type: rtoken.type,
            children: result.children,
            sp:result.sp,
            line: result.line,
            column: result.column,
            hook: result.hook,
            name: rtoken.name,
            repeat: rtoken.repeat
          });
        if(!canRepeat(rtoken)) {
          rp++;
        }
      } else {
        if(!canFail(rtoken, currentNode)) {
          return false;
        }
        rp++;
      }

    // Case two: we have a proper token
    } else {
      if(stoken.type === rtoken.type) {
        //currentNode.children.push(copyToken(stoken, rtoken));
        if(!rtoken.nonCapturing) {
          currentNode.children.push(copyToken(stoken, rtoken));
          sp++;
        }
        if(!canRepeat(rtoken)) {
          rp++;
        }
      } else {
        if(!canFail(rtoken, currentNode)) {
          return false;
        }
        rp++;
      }

    }

    // information used for debugging purpose
    if(best_p === sp) {
      best_parse.candidates.push([rule, rule.tokens[rp]]);
    }
    if(best_p < sp) {
      best_parse = {sp:sp, candidates:[[rule, rule.tokens[rp]]]};
      best_p = sp;
    }

    // fetch next rule and stream token
    rtoken = rule.tokens[rp];
    stoken = stream[sp];

    // rule satisfied
    if(rtoken === undefined) {
      currentNode.sp = sp;
      currentNode.rp = rp;
      return currentNode;
    }

    // no more tokens
    if(stoken === undefined) {
      if(canFail(rtoken, currentNode)) {
        // This does not happen often because of EOF,
        // As it stands the last token as always to be EOF
        currentNode.sp = sp;
        currentNode.rp = rp;
        return currentNode;
      }
      return false;
    }

  } // end rule body loop

  return false;
}

function splitTrim(l, split) {
  return l.split(split).map(function(i){ return i.trim(); });
}

function grammarToken(token) {
  var nonCapturing = token.charAt(0) === '!';
  if(nonCapturing) {
    token = token.substr(1);
  }
  var repeat = token.charAt(token.length - 1);
  if(repeat === '*' || repeat === '?' || repeat === '+') {
    token = token.substr(0, token.length - 1);
  } else {
    repeat = false;
  }
  var named = token.split(":"), t;
  if(named.length === 2) {
    t = {
      'type': named[1],
      'name' :named[0]
    };
  } else {
    t = {'type': token };
  }
  t.repeat = repeat;
  if((repeat === '*' || repeat === '+') && nonCapturing) {
    throw new Error("Impossible to have non capturing token that repeats");
  }
  if(nonCapturing) {
    t.nonCapturing = nonCapturing;
  }
  return t;
}

function compileGrammar(grammar, tokenDef) {
  var keys = Object.keys(grammar), i, j, k;
  var gram = {}, optional, nonCapturing;

  gram.tokenDef = tokenDef;
  gram.tokenKeys = [];
  gram.tokenMap = {};
  tokenDef.map(function(t) {
    gram.tokenMap[t.key] = t;
    gram.tokenKeys.push(t.key);
  });

  var allValidKeys = keys.concat(gram.tokenKeys);

  for(i=0; i<keys.length; i++) {
    var line = grammar[keys[i]];
    var key = keys[i];
    var rules = line.rules;
    var hooks = [];

    var splitted_rules = [];

    for(j=0; j<rules.length; j++) {
      var tokens = splitTrim(rules[j], ' ');
      optional = 0;
      for(k=0; k<tokens.length; k++) {
        var token = tokens[k] = grammarToken(tokens[k]);
        if(allValidKeys.indexOf(token.type) === -1 && token.type !== 'EOF') {
          throw new Error("Invalid token type used in the grammar rule "+key+": " + token.type + ', valid tokens are: '+allValidKeys.join(', '));
        }
        if(token.repeat === '*') {
          optional += 1;
        }
        if(token.nonCapturing) {
          if(tokens[tokens.length - 1] != tokens[k]) {
            throw new Error("A non capturing token can only be the last one in the rule: " + token.type);
          }
        }
      }
      if(optional === tokens.length) {
        throw new Error("Rule " + rules[j] + " only has optional greedy tokens.");
      }
      splitted_rules.push({key: key, index:j, tokens:tokens});
      if(typeof line.hooks === "function") {
        hooks.push(line.hooks);
      } else if(line.hooks) {
        if(line.hooks[j] === undefined) {
          throw new Error("Incorrect number of hooks ar rule " + keys[i]); 
        }
        hooks.push(line.hooks[j]);
      }
    }
    gram[key] = {rules: splitted_rules, hooks: hooks || [], verbose:line.verbose};
  }
  gram.parse = function(stream) {
    return parse(stream, gram);
  };
  return gram;
}

function spacer(n) {
  var out = "";
  for(var i=0; i<n; i++) {
    out += " ";
  }
  return out;
}

function errorMsg(input, token, errorType, m) {

  var charn = token.pointer || 0;
  var lines = input.split("\n"), i, charCounter = 0, charOnLine = 0;

  for(i=0; i<lines.length; i++) {
    charCounter += lines[i].length + 1;
    if(charCounter >= charn) {
      break;
    }
    charOnLine += lines[i].length + 1;
  }

  var ln = Math.max(0, i); // line number
  var msg = errorType + " at line "+(ln+1)+" char "+ (charn - charOnLine) +": ";
  var indicator = "\n" + spacer((charn - charOnLine) + ((ln) + ': ').length);

  if(lines[ln-1] !== undefined) {
    msg = msg + "\n" + (ln) + ': ' + lines[ln-1];
  }
  msg = msg + "\n" + (ln+1) + ': ' + lines[ln] + indicator;
  msg = msg + "^-- " + m;

  if(lines[ln+1] !== undefined) {
    msg = msg + "\n" + (ln+2) + ': ' + lines[ln+1];
  }

  return msg;
}

function verboseName(grammar, type) {
  var tokendef = grammar.tokenMap[type];
  if(tokendef && tokendef.verbose) {
    return tokendef.verbose;
  }
  if(grammar[type] && grammar[type].verbose) {
    return grammar[type].verbose;
  }
  return type;
}

function hint(input, stream, best_parse, grammar) {
  if(!best_parse || !best_parse.candidates[0]) {
    return "Complete failure to parse";
  }
  var rule = best_parse.candidates[0][0];

  var array = [];
  best_parse.candidates.map(function(r) {
    if(!r[1]) { return; }
    var name = verboseName(grammar, r[1].type);
    if(array.indexOf(name) === -1) {
      array.push(name);
    }
  });
  var candidates = array.join(' or ');

  var msg = errorMsg(input, stream[best_parse.sp], "Parser error", "Rule " + verboseName(grammar, rule.key));
  msg = msg + "\nExpect " + candidates;
  var lastToken = stream[best_parse.sp] || {type:"EOF"};
  msg = msg + "\nBut got " + verboseName(grammar, lastToken.type) + " instead";

  return msg;
}

// those are module globals
var stack = [];
var memoization = {};
var best_parse = null;
var best_p = 0;

function hookTree(node) {
  if(!node.children) {
    return;
  }
  for(var i=0; i<node.children.length; i++) {
    hookTree(node.children[i]);
  }
  if(node.hook) {
    node.children = node.hook(createParams(node.children));
  }
}

function parse(input, grammar) {
  var bestResult = {type:'START', sp:0, complete:false}, i, result, stream;
  //if(typeof input === 'string') {
  stream = tokenize(input, grammar);
  //}
  best_parse = {sp:0, candidates:[]};
  best_p = 0;
  for(i=0; i<grammar.START.rules.length; i++) {
    stack = [];
    memoization = {};
    result = memoEval(grammar, grammar.START.rules[i], stream, 0);
    if(result && result.sp > bestResult.sp) {
      bestResult = {
        type:'START',
        children:result.children,
        sp: result.sp,
        line: 1,
        column: 1,
        complete:result.sp === stream.length,
        inputLength:stream.length,
      };
    }
  }
  bestResult.bestParse = best_parse;
  hookTree(bestResult);
  if(best_parse && !bestResult.complete) {
    bestResult.hint = hint(input, stream, best_parse, grammar);
  }
  return bestResult;
}

module.exports = {
  parse: parse,
  stack: stack,
  compileGrammar: compileGrammar,
  tokenize: tokenize,
  memoization: memoization
};

},{}]},{},[1])(1)
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJFUEVHLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIvKlxuICBKYXZhU2NyaXB0IGltcGxlbWVudGF0aW9uIG9mIGEgUGFja3JhdCBQYXJzZXJzIHdpdGggbGVmdCBSZWN1cnNpb24gU3VwcG9ydFxuICBodHRwOi8vd3d3LnZwcmkub3JnL3BkZi90cjIwMDcwMDJfcGFja3JhdC5wZGZcblxuICBObyBJbmRpcmVjdCBMZWZ0IFJlY3Vyc2lvbiB5ZXQgOi0oXG5cbiAgQmF0aXN0ZSBCaWVsZXIgMjAxNFxuKi9cblwidXNlIHN0cmljdFwiO1xuXG5mdW5jdGlvbiB0b2tlbml6ZShpbnB1dCwgZ3JhbSkge1xuICB2YXIga2V5cyA9IGdyYW0udG9rZW5LZXlzO1xuICB2YXIgdG9rZW5zID0gZ3JhbS50b2tlbk1hcDtcbiAgdmFyIHN0cmVhbSA9IFtdO1xuICB2YXIgbGVuID0gaW5wdXQubGVuZ3RoLCBjYW5kaWRhdGUsIGksIGtleSwgY29weSA9IGlucHV0LCBsYXN0VG9rZW4gPSBudWxsO1xuICB2YXIgcG9pbnRlciA9IDA7XG4gIHZhciBsaW5lID0gMDtcbiAgdmFyIGNvbHVtbiA9IDA7XG5cbiAgd2hpbGUocG9pbnRlciA8IGxlbikge1xuICAgIGNhbmRpZGF0ZSA9IG51bGw7XG4gICAgZm9yKGk9MDsgaTxrZXlzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBrZXkgPSBrZXlzW2ldO1xuICAgICAgdmFyIHRva2VuID0gdG9rZW5zW2tleV0sIG1hdGNoO1xuICAgICAgaWYodG9rZW4uZnVuYykge1xuICAgICAgICBtYXRjaCA9IHRva2VuLmZ1bmMoaW5wdXQsIHN0cmVhbSk7XG4gICAgICAgIGlmKG1hdGNoICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBjYW5kaWRhdGUgPSBtYXRjaDtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmKHRva2VuLnJlZyl7XG4gICAgICAgIG1hdGNoID0gaW5wdXQubWF0Y2godG9rZW4ucmVnKTtcbiAgICAgICAgaWYobWF0Y2ggIT09IG51bGwpIHtcbiAgICAgICAgICBjYW5kaWRhdGUgPSBtYXRjaFswXTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmKHRva2VuLnN0cil7XG4gICAgICAgIG1hdGNoID0gaW5wdXQuaW5kZXhPZih0b2tlbi5zdHIpO1xuICAgICAgICBpZihtYXRjaCA9PT0gMCkge1xuICAgICAgICAgIGNhbmRpZGF0ZSA9IHRva2VuLnN0cjtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVG9rZW5pemVyIGVycm9yOiBJbnZhbGlkIHRva2VuIFwiICsga2V5ICsgXCIgd2l0aG91dCBhIHJlZywgc3RyIG9yIGZ1bmMgcHJvcGVydHlcIik7XG4gICAgICB9XG4gICAgfVxuICAgIGlmKGNhbmRpZGF0ZSAhPT0gbnVsbCkge1xuICAgICAgbGFzdFRva2VuID0ge3R5cGU6a2V5LCB2YWx1ZTpjYW5kaWRhdGUsIHBvaW50ZXI6cG9pbnRlciwgbGluZTpsaW5lKzEsIGNvbHVtbjpjb2x1bW4rMX07XG4gICAgICBzdHJlYW0ucHVzaChsYXN0VG9rZW4pO1xuICAgICAgdmFyIGxpbmVfYnJlYWtzX2NvdW50ID0gY291bnRMaW5lQnJlYWsoY2FuZGlkYXRlKTtcbiAgICAgIGxpbmUgKz0gbGluZV9icmVha3NfY291bnQ7XG4gICAgICBpZihsaW5lX2JyZWFrc19jb3VudCA+IDApIHtcbiAgICAgICAgY29sdW1uID0gMDtcbiAgICAgIH1cbiAgICAgIGNvbHVtbiArPSBjb3VudENvbHVtbihjYW5kaWRhdGUpO1xuICAgICAgcG9pbnRlciArPSBjYW5kaWRhdGUubGVuZ3RoO1xuICAgICAgaW5wdXQgPSBpbnB1dC5zdWJzdHIoY2FuZGlkYXRlLmxlbmd0aCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmKHN0cmVhbS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVG9rZW5pemVyIGVycm9yOiB0b3RhbCBtYXRjaCBmYWlsdXJlXCIpO1xuICAgICAgfVxuICAgICAgaWYobGFzdFRva2VuKVxuICAgICAgICBsYXN0VG9rZW4ucG9pbnRlciArPSBsYXN0VG9rZW4udmFsdWUubGVuZ3RoO1xuICAgICAgdmFyIG1zZyA9IGVycm9yTXNnKGNvcHksIHN0cmVhbVtzdHJlYW0ubGVuZ3RoIC0gMV0sIFwiVG9rZW5pemVyIGVycm9yXCIsIFwiTm8gbWF0Y2hpbmcgdG9rZW4gZm91bmRcIik7XG4gICAgICBpZihsYXN0VG9rZW4pXG4gICAgICAgIG1zZyArPSBcIlxcblwiICsgXCJCZWZvcmUgdG9rZW4gb2YgdHlwZSBcIiArIGxhc3RUb2tlbi50eXBlICsgXCI6IFwiICsgbGFzdFRva2VuLnZhbHVlO1xuICAgICAgdGhyb3cgbmV3IEVycm9yKG1zZyk7XG4gICAgfVxuICB9XG4gIHN0cmVhbS5wdXNoKHt0eXBlOidFT0YnLCB2YWx1ZTpcIlwifSk7XG4gIHJldHVybiBzdHJlYW07XG59XG5cbmZ1bmN0aW9uIGNvdW50TGluZUJyZWFrKHN0cikge1xuICB2YXIgbSA9IHN0ci5zcGxpdCgvXFxuL2cpO1xuICByZXR1cm4gbS5sZW5ndGggLSAxO1xufVxuXG5mdW5jdGlvbiBjb3VudENvbHVtbihzdHIpIHtcbiAgdmFyIG0gPSBzdHIuc3BsaXQoL1xcbi9nKTtcbiAgcmV0dXJuIG1bbS5sZW5ndGgtMV0ubGVuZ3RoO1xufVxuXG5mdW5jdGlvbiBjb3B5VG9rZW4oc3Rva2VuLCBydG9rZW4pIHtcbiAgdmFyIHQgPSB7XG4gICAgdHlwZTpzdG9rZW4udHlwZSxcbiAgICB2YWx1ZTpzdG9rZW4udmFsdWUsXG4gICAgcmVwZWF0OnJ0b2tlbi5yZXBlYXQsXG4gICAgbGluZTpzdG9rZW4ubGluZSxcbiAgICBjb2x1bW46c3Rva2VuLmNvbHVtblxuICB9O1xuICBpZihydG9rZW4ubmFtZSkge1xuICAgIHQubmFtZSA9IHJ0b2tlbi5uYW1lO1xuICB9XG4gIHJldHVybiB0O1xufVxuXG5mdW5jdGlvbiBjcmVhdGVQYXJhbXModG9rZW5zKSB7XG4gIHZhciBwYXJhbXMgPSB7fTtcbiAgdmFyIGogPSAwO1xuICB0b2tlbnMubWFwKGZ1bmN0aW9uKGkpIHtcbiAgICBpZihpLm5hbWUpIHtcbiAgICAgIGlmKGkucmVwZWF0ID09ICcqJyB8fCBpLnJlcGVhdCA9PSAnKycpIHtcbiAgICAgICAgaWYoIXBhcmFtc1tpLm5hbWVdKSB7XG4gICAgICAgICAgcGFyYW1zW2kubmFtZV0gPSBbXTtcbiAgICAgICAgfVxuICAgICAgICBwYXJhbXNbaS5uYW1lXS5wdXNoKGkpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcGFyYW1zW2kubmFtZV0gPSBpO1xuICAgICAgfVxuICAgIH1cbiAgICBwYXJhbXNbJyQnK2pdID0gaTtcbiAgICBqKys7XG4gIH0pO1xuICByZXR1cm4gcGFyYW1zO1xufVxuXG5mdW5jdGlvbiBncm93TFIoZ3JhbW1hciwgcnVsZSwgc3RyZWFtLCBwb3MsIG1lbW8pIHtcbiAgdmFyIHNwLCByZXN1bHQsIHByb2dyZXNzID0gZmFsc2U7XG4gIHZhciBob29rID0gZ3JhbW1hcltydWxlLmtleV0uaG9va3NbcnVsZS5pbmRleF07XG5cbiAgd2hpbGUodHJ1ZSkge1xuICAgIHNwID0gcG9zO1xuXG4gICAgcmVzdWx0ID0gZXZhbFJ1bGVCb2R5KGdyYW1tYXIsIHJ1bGUsIHN0cmVhbSwgc3ApO1xuXG4gICAgLy8gZW5zdXJlIHNvbWUgcHJvZ3Jlc3MgaXMgbWFkZVxuICAgIGlmKHJlc3VsdCA9PT0gZmFsc2UgfHwgcmVzdWx0LnNwIDw9IG1lbW8uc3ApIHtcbiAgICAgIHJldHVybiBwcm9ncmVzcztcbiAgICB9XG5cbiAgICByZXN1bHQuaG9vayA9IGhvb2s7XG5cbiAgICAvLyBpdCdzIHZlcnkgaW1wb3J0YW50IHRvIHVwZGF0ZSB0aGUgbWVtb2l6ZWQgdmFsdWVcbiAgICAvLyB0aGlzIGlzIGFjdHVhbGx5IGdyb3dpbmcgdGhlIHNlZWQgaW4gdGhlIG1lbW9pemF0aW9uXG4gICAgbWVtby5jaGlsZHJlbiA9IHJlc3VsdC5jaGlsZHJlbjtcbiAgICBtZW1vLnNwID0gcmVzdWx0LnNwO1xuICAgIG1lbW8ubGluZSA9IHJlc3VsdC5saW5lO1xuICAgIG1lbW8uY29sdW1uID0gcmVzdWx0LmNvbHVtbjtcbiAgICBtZW1vLnN0YXJ0ID0gcmVzdWx0LnN0YXJ0O1xuICAgIG1lbW8uaG9va2VkID0gcmVzdWx0Lmhvb2tlZDtcbiAgICBtZW1vLmhvb2sgPSByZXN1bHQuaG9vaztcbiAgICBwcm9ncmVzcyA9IHJlc3VsdDtcbiAgfVxuICByZXR1cm4gcHJvZ3Jlc3M7XG59XG5cbmZ1bmN0aW9uIG1lbW9FdmFsKGdyYW1tYXIsIHJ1bGUsIHN0cmVhbSwgcG9pbnRlcikge1xuXG4gIHZhciBrZXkgPSBydWxlLmtleSsnOycrcG9pbnRlcisnOycrcnVsZS5pbmRleDtcblxuICAvLyBhdm9pZCBpbmZpbml0ZSByZWN1cnNpb25cbiAgLy8gVGhpcyBpcyBmYXN0ZXIgdGhhbiBmaWx0ZXJcbiAgdmFyIGkgPSBzdGFjay5sZW5ndGggLSAxO1xuICB3aGlsZShpID49IDApIHtcbiAgICBpZihzdGFja1tpXVswXSA9PSBrZXkpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgaSA9IGktMTtcbiAgfVxuXG4gIHZhciBtZW1vX2VudHJ5ID0gbWVtb2l6YXRpb25bcnVsZS5rZXkrJzsnK3BvaW50ZXJdO1xuICBpZihtZW1vX2VudHJ5ICE9PSB1bmRlZmluZWQpIHtcbiAgICByZXR1cm4gbWVtb19lbnRyeTtcbiAgfVxuXG4gIHN0YWNrLnB1c2goW2tleSwgcnVsZV0pO1xuICB2YXIgcmVzdWx0ID0gZXZhbFJ1bGVCb2R5KGdyYW1tYXIsIHJ1bGUsIHN0cmVhbSwgcG9pbnRlcik7XG4gIHN0YWNrLnBvcCgpO1xuXG4gIHJldHVybiByZXN1bHQ7XG59XG5cbmZ1bmN0aW9uIGNhbkZhaWwodG9rZW4sIG5vZGUpIHtcbiAgaWYodG9rZW4ucmVwZWF0ID09PSAnKicgfHwgdG9rZW4ucmVwZWF0ID09PSAnPycpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuICBpZih0b2tlbi5yZXBlYXQgPT09ICcrJyAmJiBub2RlLmNoaWxkcmVuLmxlbmd0aCAmJiBub2RlLmNoaWxkcmVuW25vZGUuY2hpbGRyZW4ubGVuZ3RoIC0gMV0udHlwZSA9PSB0b2tlbi50eXBlKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG5mdW5jdGlvbiBjYW5SZXBlYXQodG9rZW4pIHtcbiAgcmV0dXJuIHRva2VuLnJlcGVhdCA9PT0gJyonIHx8IHRva2VuLnJlcGVhdCA9PT0gJysnO1xufVxuXG5mdW5jdGlvbiBldmFsUnVsZUJvZHkoZ3JhbW1hciwgcnVsZSwgc3RyZWFtLCBwb2ludGVyKSB7XG5cbiAgdmFyIHNwID0gcG9pbnRlcjsgLy8gc3RyZWFtIHBvaW50ZXJcbiAgdmFyIHJwID0gMDsgICAgICAgLy8gcnVsZSBwb2ludGVyXG4gIHZhciBqLCByZXN1bHQ7XG5cbiAgdmFyIHJ0b2tlbiA9IHJ1bGUudG9rZW5zW3JwXTtcbiAgdmFyIHN0b2tlbiA9IHN0cmVhbVtzcF07XG5cbiAgdmFyIGN1cnJlbnROb2RlID0ge1xuICAgIHR5cGU6IHJ1bGUua2V5LCBcbiAgICBjaGlsZHJlbjpbXSwgXG4gICAgc3RhcnQ6cG9pbnRlciwgXG4gICAgbmFtZTpydWxlLm5hbWUsIFxuICAgIGxpbmU6c3Rva2VuLmxpbmUsIFxuICAgIGNvbHVtbjpzdG9rZW4uY29sdW1uXG4gIH07XG5cbiAgd2hpbGUocnRva2VuICYmIHN0b2tlbikge1xuXG4gICAgLy8gQ2FzZSBvbmU6IHdlIGhhdmUgYSBydWxlIHdlIG5lZWQgdG8gZGV2ZWxvcFxuICAgIGlmKGdyYW1tYXJbcnRva2VuLnR5cGVdKSB7XG5cbiAgICAgIHZhciBleHBhbmRfcnVsZXMgPSBncmFtbWFyW3J0b2tlbi50eXBlXS5ydWxlcztcbiAgICAgIHZhciBob29rcyA9IGdyYW1tYXJbcnRva2VuLnR5cGVdLmhvb2tzO1xuICAgICAgcmVzdWx0ID0gZmFsc2U7XG5cbiAgICAgIHZhciBtID0gbWVtb2l6YXRpb25bcnRva2VuLnR5cGUrJzsnK3NwXTtcbiAgICAgIGlmKG0pIHtcbiAgICAgICAgcmVzdWx0ID0gbTtcbiAgICAgIH1cblxuICAgICAgaWYoIXJlc3VsdCkge1xuICAgICAgICBmb3Ioaj0wOyBqPGV4cGFuZF9ydWxlcy5sZW5ndGg7IGorKykge1xuICAgICAgICAgIHZhciByID0gZXhwYW5kX3J1bGVzW2pdLCBob29rID0gaG9va3Nbal07XG5cbiAgICAgICAgICByZXN1bHQgPSBtZW1vRXZhbChncmFtbWFyLCByLCBzdHJlYW0sIHNwKTtcblxuICAgICAgICAgIGlmKHJlc3VsdCkge1xuXG4gICAgICAgICAgICByZXN1bHQuaG9vayA9IGhvb2s7XG5cbiAgICAgICAgICAgIG1lbW9pemF0aW9uW3Iua2V5Kyc7JytzcF0gPSByZXN1bHQ7XG5cbiAgICAgICAgICAgIGlmKHJ0b2tlbi5yZXBlYXQgPT09IGZhbHNlKSB7XG4gICAgICAgICAgICAgIHZhciBuX3Jlc3VsdCA9IGdyb3dMUihncmFtbWFyLCBydWxlLCBzdHJlYW0sIHNwLCByZXN1bHQpO1xuICAgICAgICAgICAgICBpZihuX3Jlc3VsdCAhPT0gZmFsc2UpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gbl9yZXN1bHQ7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZihyZXN1bHQpIHtcbiAgICAgICAgc3AgPSByZXN1bHQuc3A7XG4gICAgICAgIGN1cnJlbnROb2RlLmNoaWxkcmVuLnB1c2goe1xuICAgICAgICAgICAgdHlwZTogcnRva2VuLnR5cGUsXG4gICAgICAgICAgICBjaGlsZHJlbjogcmVzdWx0LmNoaWxkcmVuLFxuICAgICAgICAgICAgc3A6cmVzdWx0LnNwLFxuICAgICAgICAgICAgbGluZTogcmVzdWx0LmxpbmUsXG4gICAgICAgICAgICBjb2x1bW46IHJlc3VsdC5jb2x1bW4sXG4gICAgICAgICAgICBob29rOiByZXN1bHQuaG9vayxcbiAgICAgICAgICAgIG5hbWU6IHJ0b2tlbi5uYW1lLFxuICAgICAgICAgICAgcmVwZWF0OiBydG9rZW4ucmVwZWF0XG4gICAgICAgICAgfSk7XG4gICAgICAgIGlmKCFjYW5SZXBlYXQocnRva2VuKSkge1xuICAgICAgICAgIHJwKys7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmKCFjYW5GYWlsKHJ0b2tlbiwgY3VycmVudE5vZGUpKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIHJwKys7XG4gICAgICB9XG5cbiAgICAvLyBDYXNlIHR3bzogd2UgaGF2ZSBhIHByb3BlciB0b2tlblxuICAgIH0gZWxzZSB7XG4gICAgICBpZihzdG9rZW4udHlwZSA9PT0gcnRva2VuLnR5cGUpIHtcbiAgICAgICAgLy9jdXJyZW50Tm9kZS5jaGlsZHJlbi5wdXNoKGNvcHlUb2tlbihzdG9rZW4sIHJ0b2tlbikpO1xuICAgICAgICBpZighcnRva2VuLm5vbkNhcHR1cmluZykge1xuICAgICAgICAgIGN1cnJlbnROb2RlLmNoaWxkcmVuLnB1c2goY29weVRva2VuKHN0b2tlbiwgcnRva2VuKSk7XG4gICAgICAgICAgc3ArKztcbiAgICAgICAgfVxuICAgICAgICBpZighY2FuUmVwZWF0KHJ0b2tlbikpIHtcbiAgICAgICAgICBycCsrO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZighY2FuRmFpbChydG9rZW4sIGN1cnJlbnROb2RlKSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBycCsrO1xuICAgICAgfVxuXG4gICAgfVxuXG4gICAgLy8gaW5mb3JtYXRpb24gdXNlZCBmb3IgZGVidWdnaW5nIHB1cnBvc2VcbiAgICBpZihiZXN0X3AgPT09IHNwKSB7XG4gICAgICBiZXN0X3BhcnNlLmNhbmRpZGF0ZXMucHVzaChbcnVsZSwgcnVsZS50b2tlbnNbcnBdXSk7XG4gICAgfVxuICAgIGlmKGJlc3RfcCA8IHNwKSB7XG4gICAgICBiZXN0X3BhcnNlID0ge3NwOnNwLCBjYW5kaWRhdGVzOltbcnVsZSwgcnVsZS50b2tlbnNbcnBdXV19O1xuICAgICAgYmVzdF9wID0gc3A7XG4gICAgfVxuXG4gICAgLy8gZmV0Y2ggbmV4dCBydWxlIGFuZCBzdHJlYW0gdG9rZW5cbiAgICBydG9rZW4gPSBydWxlLnRva2Vuc1tycF07XG4gICAgc3Rva2VuID0gc3RyZWFtW3NwXTtcblxuICAgIC8vIHJ1bGUgc2F0aXNmaWVkXG4gICAgaWYocnRva2VuID09PSB1bmRlZmluZWQpIHtcbiAgICAgIGN1cnJlbnROb2RlLnNwID0gc3A7XG4gICAgICBjdXJyZW50Tm9kZS5ycCA9IHJwO1xuICAgICAgcmV0dXJuIGN1cnJlbnROb2RlO1xuICAgIH1cblxuICAgIC8vIG5vIG1vcmUgdG9rZW5zXG4gICAgaWYoc3Rva2VuID09PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmKGNhbkZhaWwocnRva2VuLCBjdXJyZW50Tm9kZSkpIHtcbiAgICAgICAgLy8gVGhpcyBkb2VzIG5vdCBoYXBwZW4gb2Z0ZW4gYmVjYXVzZSBvZiBFT0YsXG4gICAgICAgIC8vIEFzIGl0IHN0YW5kcyB0aGUgbGFzdCB0b2tlbiBhcyBhbHdheXMgdG8gYmUgRU9GXG4gICAgICAgIGN1cnJlbnROb2RlLnNwID0gc3A7XG4gICAgICAgIGN1cnJlbnROb2RlLnJwID0gcnA7XG4gICAgICAgIHJldHVybiBjdXJyZW50Tm9kZTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgfSAvLyBlbmQgcnVsZSBib2R5IGxvb3BcblxuICByZXR1cm4gZmFsc2U7XG59XG5cbmZ1bmN0aW9uIHNwbGl0VHJpbShsLCBzcGxpdCkge1xuICByZXR1cm4gbC5zcGxpdChzcGxpdCkubWFwKGZ1bmN0aW9uKGkpeyByZXR1cm4gaS50cmltKCk7IH0pO1xufVxuXG5mdW5jdGlvbiBncmFtbWFyVG9rZW4odG9rZW4pIHtcbiAgdmFyIG5vbkNhcHR1cmluZyA9IHRva2VuLmNoYXJBdCgwKSA9PT0gJyEnO1xuICBpZihub25DYXB0dXJpbmcpIHtcbiAgICB0b2tlbiA9IHRva2VuLnN1YnN0cigxKTtcbiAgfVxuICB2YXIgcmVwZWF0ID0gdG9rZW4uY2hhckF0KHRva2VuLmxlbmd0aCAtIDEpO1xuICBpZihyZXBlYXQgPT09ICcqJyB8fCByZXBlYXQgPT09ICc/JyB8fCByZXBlYXQgPT09ICcrJykge1xuICAgIHRva2VuID0gdG9rZW4uc3Vic3RyKDAsIHRva2VuLmxlbmd0aCAtIDEpO1xuICB9IGVsc2Uge1xuICAgIHJlcGVhdCA9IGZhbHNlO1xuICB9XG4gIHZhciBuYW1lZCA9IHRva2VuLnNwbGl0KFwiOlwiKSwgdDtcbiAgaWYobmFtZWQubGVuZ3RoID09PSAyKSB7XG4gICAgdCA9IHtcbiAgICAgICd0eXBlJzogbmFtZWRbMV0sXG4gICAgICAnbmFtZScgOm5hbWVkWzBdXG4gICAgfTtcbiAgfSBlbHNlIHtcbiAgICB0ID0geyd0eXBlJzogdG9rZW4gfTtcbiAgfVxuICB0LnJlcGVhdCA9IHJlcGVhdDtcbiAgaWYoKHJlcGVhdCA9PT0gJyonIHx8IHJlcGVhdCA9PT0gJysnKSAmJiBub25DYXB0dXJpbmcpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJJbXBvc3NpYmxlIHRvIGhhdmUgbm9uIGNhcHR1cmluZyB0b2tlbiB0aGF0IHJlcGVhdHNcIik7XG4gIH1cbiAgaWYobm9uQ2FwdHVyaW5nKSB7XG4gICAgdC5ub25DYXB0dXJpbmcgPSBub25DYXB0dXJpbmc7XG4gIH1cbiAgcmV0dXJuIHQ7XG59XG5cbmZ1bmN0aW9uIGNvbXBpbGVHcmFtbWFyKGdyYW1tYXIsIHRva2VuRGVmKSB7XG4gIHZhciBrZXlzID0gT2JqZWN0LmtleXMoZ3JhbW1hciksIGksIGosIGs7XG4gIHZhciBncmFtID0ge30sIG9wdGlvbmFsLCBub25DYXB0dXJpbmc7XG5cbiAgZ3JhbS50b2tlbkRlZiA9IHRva2VuRGVmO1xuICBncmFtLnRva2VuS2V5cyA9IFtdO1xuICBncmFtLnRva2VuTWFwID0ge307XG4gIHRva2VuRGVmLm1hcChmdW5jdGlvbih0KSB7XG4gICAgZ3JhbS50b2tlbk1hcFt0LmtleV0gPSB0O1xuICAgIGdyYW0udG9rZW5LZXlzLnB1c2godC5rZXkpO1xuICB9KTtcblxuICB2YXIgYWxsVmFsaWRLZXlzID0ga2V5cy5jb25jYXQoZ3JhbS50b2tlbktleXMpO1xuXG4gIGZvcihpPTA7IGk8a2V5cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciBsaW5lID0gZ3JhbW1hcltrZXlzW2ldXTtcbiAgICB2YXIga2V5ID0ga2V5c1tpXTtcbiAgICB2YXIgcnVsZXMgPSBsaW5lLnJ1bGVzO1xuICAgIHZhciBob29rcyA9IFtdO1xuXG4gICAgdmFyIHNwbGl0dGVkX3J1bGVzID0gW107XG5cbiAgICBmb3Ioaj0wOyBqPHJ1bGVzLmxlbmd0aDsgaisrKSB7XG4gICAgICB2YXIgdG9rZW5zID0gc3BsaXRUcmltKHJ1bGVzW2pdLCAnICcpO1xuICAgICAgb3B0aW9uYWwgPSAwO1xuICAgICAgZm9yKGs9MDsgazx0b2tlbnMubGVuZ3RoOyBrKyspIHtcbiAgICAgICAgdmFyIHRva2VuID0gdG9rZW5zW2tdID0gZ3JhbW1hclRva2VuKHRva2Vuc1trXSk7XG4gICAgICAgIGlmKGFsbFZhbGlkS2V5cy5pbmRleE9mKHRva2VuLnR5cGUpID09PSAtMSAmJiB0b2tlbi50eXBlICE9PSAnRU9GJykge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIkludmFsaWQgdG9rZW4gdHlwZSB1c2VkIGluIHRoZSBncmFtbWFyIHJ1bGUgXCIra2V5K1wiOiBcIiArIHRva2VuLnR5cGUgKyAnLCB2YWxpZCB0b2tlbnMgYXJlOiAnK2FsbFZhbGlkS2V5cy5qb2luKCcsICcpKTtcbiAgICAgICAgfVxuICAgICAgICBpZih0b2tlbi5yZXBlYXQgPT09ICcqJykge1xuICAgICAgICAgIG9wdGlvbmFsICs9IDE7XG4gICAgICAgIH1cbiAgICAgICAgaWYodG9rZW4ubm9uQ2FwdHVyaW5nKSB7XG4gICAgICAgICAgaWYodG9rZW5zW3Rva2Vucy5sZW5ndGggLSAxXSAhPSB0b2tlbnNba10pIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIkEgbm9uIGNhcHR1cmluZyB0b2tlbiBjYW4gb25seSBiZSB0aGUgbGFzdCBvbmUgaW4gdGhlIHJ1bGU6IFwiICsgdG9rZW4udHlwZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZihvcHRpb25hbCA9PT0gdG9rZW5zLmxlbmd0aCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSdWxlIFwiICsgcnVsZXNbal0gKyBcIiBvbmx5IGhhcyBvcHRpb25hbCBncmVlZHkgdG9rZW5zLlwiKTtcbiAgICAgIH1cbiAgICAgIHNwbGl0dGVkX3J1bGVzLnB1c2goe2tleToga2V5LCBpbmRleDpqLCB0b2tlbnM6dG9rZW5zfSk7XG4gICAgICBpZih0eXBlb2YgbGluZS5ob29rcyA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgIGhvb2tzLnB1c2gobGluZS5ob29rcyk7XG4gICAgICB9IGVsc2UgaWYobGluZS5ob29rcykge1xuICAgICAgICBpZihsaW5lLmhvb2tzW2pdID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJJbmNvcnJlY3QgbnVtYmVyIG9mIGhvb2tzIGFyIHJ1bGUgXCIgKyBrZXlzW2ldKTsgXG4gICAgICAgIH1cbiAgICAgICAgaG9va3MucHVzaChsaW5lLmhvb2tzW2pdKTtcbiAgICAgIH1cbiAgICB9XG4gICAgZ3JhbVtrZXldID0ge3J1bGVzOiBzcGxpdHRlZF9ydWxlcywgaG9va3M6IGhvb2tzIHx8IFtdLCB2ZXJib3NlOmxpbmUudmVyYm9zZX07XG4gIH1cbiAgZ3JhbS5wYXJzZSA9IGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgIHJldHVybiBwYXJzZShzdHJlYW0sIGdyYW0pO1xuICB9O1xuICByZXR1cm4gZ3JhbTtcbn1cblxuZnVuY3Rpb24gc3BhY2VyKG4pIHtcbiAgdmFyIG91dCA9IFwiXCI7XG4gIGZvcih2YXIgaT0wOyBpPG47IGkrKykge1xuICAgIG91dCArPSBcIiBcIjtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG5mdW5jdGlvbiBlcnJvck1zZyhpbnB1dCwgdG9rZW4sIGVycm9yVHlwZSwgbSkge1xuXG4gIHZhciBjaGFybiA9IHRva2VuLnBvaW50ZXIgfHwgMDtcbiAgdmFyIGxpbmVzID0gaW5wdXQuc3BsaXQoXCJcXG5cIiksIGksIGNoYXJDb3VudGVyID0gMCwgY2hhck9uTGluZSA9IDA7XG5cbiAgZm9yKGk9MDsgaTxsaW5lcy5sZW5ndGg7IGkrKykge1xuICAgIGNoYXJDb3VudGVyICs9IGxpbmVzW2ldLmxlbmd0aCArIDE7XG4gICAgaWYoY2hhckNvdW50ZXIgPj0gY2hhcm4pIHtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBjaGFyT25MaW5lICs9IGxpbmVzW2ldLmxlbmd0aCArIDE7XG4gIH1cblxuICB2YXIgbG4gPSBNYXRoLm1heCgwLCBpKTsgLy8gbGluZSBudW1iZXJcbiAgdmFyIG1zZyA9IGVycm9yVHlwZSArIFwiIGF0IGxpbmUgXCIrKGxuKzEpK1wiIGNoYXIgXCIrIChjaGFybiAtIGNoYXJPbkxpbmUpICtcIjogXCI7XG4gIHZhciBpbmRpY2F0b3IgPSBcIlxcblwiICsgc3BhY2VyKChjaGFybiAtIGNoYXJPbkxpbmUpICsgKChsbikgKyAnOiAnKS5sZW5ndGgpO1xuXG4gIGlmKGxpbmVzW2xuLTFdICE9PSB1bmRlZmluZWQpIHtcbiAgICBtc2cgPSBtc2cgKyBcIlxcblwiICsgKGxuKSArICc6ICcgKyBsaW5lc1tsbi0xXTtcbiAgfVxuICBtc2cgPSBtc2cgKyBcIlxcblwiICsgKGxuKzEpICsgJzogJyArIGxpbmVzW2xuXSArIGluZGljYXRvcjtcbiAgbXNnID0gbXNnICsgXCJeLS0gXCIgKyBtO1xuXG4gIGlmKGxpbmVzW2xuKzFdICE9PSB1bmRlZmluZWQpIHtcbiAgICBtc2cgPSBtc2cgKyBcIlxcblwiICsgKGxuKzIpICsgJzogJyArIGxpbmVzW2xuKzFdO1xuICB9XG5cbiAgcmV0dXJuIG1zZztcbn1cblxuZnVuY3Rpb24gdmVyYm9zZU5hbWUoZ3JhbW1hciwgdHlwZSkge1xuICB2YXIgdG9rZW5kZWYgPSBncmFtbWFyLnRva2VuTWFwW3R5cGVdO1xuICBpZih0b2tlbmRlZiAmJiB0b2tlbmRlZi52ZXJib3NlKSB7XG4gICAgcmV0dXJuIHRva2VuZGVmLnZlcmJvc2U7XG4gIH1cbiAgaWYoZ3JhbW1hclt0eXBlXSAmJiBncmFtbWFyW3R5cGVdLnZlcmJvc2UpIHtcbiAgICByZXR1cm4gZ3JhbW1hclt0eXBlXS52ZXJib3NlO1xuICB9XG4gIHJldHVybiB0eXBlO1xufVxuXG5mdW5jdGlvbiBoaW50KGlucHV0LCBzdHJlYW0sIGJlc3RfcGFyc2UsIGdyYW1tYXIpIHtcbiAgaWYoIWJlc3RfcGFyc2UgfHwgIWJlc3RfcGFyc2UuY2FuZGlkYXRlc1swXSkge1xuICAgIHJldHVybiBcIkNvbXBsZXRlIGZhaWx1cmUgdG8gcGFyc2VcIjtcbiAgfVxuICB2YXIgcnVsZSA9IGJlc3RfcGFyc2UuY2FuZGlkYXRlc1swXVswXTtcblxuICB2YXIgYXJyYXkgPSBbXTtcbiAgYmVzdF9wYXJzZS5jYW5kaWRhdGVzLm1hcChmdW5jdGlvbihyKSB7XG4gICAgaWYoIXJbMV0pIHsgcmV0dXJuOyB9XG4gICAgdmFyIG5hbWUgPSB2ZXJib3NlTmFtZShncmFtbWFyLCByWzFdLnR5cGUpO1xuICAgIGlmKGFycmF5LmluZGV4T2YobmFtZSkgPT09IC0xKSB7XG4gICAgICBhcnJheS5wdXNoKG5hbWUpO1xuICAgIH1cbiAgfSk7XG4gIHZhciBjYW5kaWRhdGVzID0gYXJyYXkuam9pbignIG9yICcpO1xuXG4gIHZhciBtc2cgPSBlcnJvck1zZyhpbnB1dCwgc3RyZWFtW2Jlc3RfcGFyc2Uuc3BdLCBcIlBhcnNlciBlcnJvclwiLCBcIlJ1bGUgXCIgKyB2ZXJib3NlTmFtZShncmFtbWFyLCBydWxlLmtleSkpO1xuICBtc2cgPSBtc2cgKyBcIlxcbkV4cGVjdCBcIiArIGNhbmRpZGF0ZXM7XG4gIHZhciBsYXN0VG9rZW4gPSBzdHJlYW1bYmVzdF9wYXJzZS5zcF0gfHwge3R5cGU6XCJFT0ZcIn07XG4gIG1zZyA9IG1zZyArIFwiXFxuQnV0IGdvdCBcIiArIHZlcmJvc2VOYW1lKGdyYW1tYXIsIGxhc3RUb2tlbi50eXBlKSArIFwiIGluc3RlYWRcIjtcblxuICByZXR1cm4gbXNnO1xufVxuXG4vLyB0aG9zZSBhcmUgbW9kdWxlIGdsb2JhbHNcbnZhciBzdGFjayA9IFtdO1xudmFyIG1lbW9pemF0aW9uID0ge307XG52YXIgYmVzdF9wYXJzZSA9IG51bGw7XG52YXIgYmVzdF9wID0gMDtcblxuZnVuY3Rpb24gaG9va1RyZWUobm9kZSkge1xuICBpZighbm9kZS5jaGlsZHJlbikge1xuICAgIHJldHVybjtcbiAgfVxuICBmb3IodmFyIGk9MDsgaTxub2RlLmNoaWxkcmVuLmxlbmd0aDsgaSsrKSB7XG4gICAgaG9va1RyZWUobm9kZS5jaGlsZHJlbltpXSk7XG4gIH1cbiAgaWYobm9kZS5ob29rKSB7XG4gICAgbm9kZS5jaGlsZHJlbiA9IG5vZGUuaG9vayhjcmVhdGVQYXJhbXMobm9kZS5jaGlsZHJlbikpO1xuICB9XG59XG5cbmZ1bmN0aW9uIHBhcnNlKGlucHV0LCBncmFtbWFyKSB7XG4gIHZhciBiZXN0UmVzdWx0ID0ge3R5cGU6J1NUQVJUJywgc3A6MCwgY29tcGxldGU6ZmFsc2V9LCBpLCByZXN1bHQsIHN0cmVhbTtcbiAgLy9pZih0eXBlb2YgaW5wdXQgPT09ICdzdHJpbmcnKSB7XG4gIHN0cmVhbSA9IHRva2VuaXplKGlucHV0LCBncmFtbWFyKTtcbiAgLy99XG4gIGJlc3RfcGFyc2UgPSB7c3A6MCwgY2FuZGlkYXRlczpbXX07XG4gIGJlc3RfcCA9IDA7XG4gIGZvcihpPTA7IGk8Z3JhbW1hci5TVEFSVC5ydWxlcy5sZW5ndGg7IGkrKykge1xuICAgIHN0YWNrID0gW107XG4gICAgbWVtb2l6YXRpb24gPSB7fTtcbiAgICByZXN1bHQgPSBtZW1vRXZhbChncmFtbWFyLCBncmFtbWFyLlNUQVJULnJ1bGVzW2ldLCBzdHJlYW0sIDApO1xuICAgIGlmKHJlc3VsdCAmJiByZXN1bHQuc3AgPiBiZXN0UmVzdWx0LnNwKSB7XG4gICAgICBiZXN0UmVzdWx0ID0ge1xuICAgICAgICB0eXBlOidTVEFSVCcsXG4gICAgICAgIGNoaWxkcmVuOnJlc3VsdC5jaGlsZHJlbixcbiAgICAgICAgc3A6IHJlc3VsdC5zcCxcbiAgICAgICAgbGluZTogMSxcbiAgICAgICAgY29sdW1uOiAxLFxuICAgICAgICBjb21wbGV0ZTpyZXN1bHQuc3AgPT09IHN0cmVhbS5sZW5ndGgsXG4gICAgICAgIGlucHV0TGVuZ3RoOnN0cmVhbS5sZW5ndGgsXG4gICAgICB9O1xuICAgIH1cbiAgfVxuICBiZXN0UmVzdWx0LmJlc3RQYXJzZSA9IGJlc3RfcGFyc2U7XG4gIGhvb2tUcmVlKGJlc3RSZXN1bHQpO1xuICBpZihiZXN0X3BhcnNlICYmICFiZXN0UmVzdWx0LmNvbXBsZXRlKSB7XG4gICAgYmVzdFJlc3VsdC5oaW50ID0gaGludChpbnB1dCwgc3RyZWFtLCBiZXN0X3BhcnNlLCBncmFtbWFyKTtcbiAgfVxuICByZXR1cm4gYmVzdFJlc3VsdDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIHBhcnNlOiBwYXJzZSxcbiAgc3RhY2s6IHN0YWNrLFxuICBjb21waWxlR3JhbW1hcjogY29tcGlsZUdyYW1tYXIsXG4gIHRva2VuaXplOiB0b2tlbml6ZSxcbiAgbWVtb2l6YXRpb246IG1lbW9pemF0aW9uXG59O1xuIl19

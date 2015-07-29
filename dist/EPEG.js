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
      } else {
        throw new Error("Tokenizer error: Invalid token " + key + " without a reg or func property");
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
            repeat: rtoken.repeat,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJFUEVHLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIvKlxuICBKYXZhU2NyaXB0IGltcGxlbWVudGF0aW9uIG9mIGEgUGFja3JhdCBQYXJzZXJzIHdpdGggbGVmdCBSZWN1cnNpb24gU3VwcG9ydFxuICBodHRwOi8vd3d3LnZwcmkub3JnL3BkZi90cjIwMDcwMDJfcGFja3JhdC5wZGZcblxuICBObyBJbmRpcmVjdCBMZWZ0IFJlY3Vyc2lvbiB5ZXQgOi0oXG5cbiAgQmF0aXN0ZSBCaWVsZXIgMjAxNFxuKi9cblwidXNlIHN0cmljdFwiO1xuXG5mdW5jdGlvbiB0b2tlbml6ZShpbnB1dCwgZ3JhbSkge1xuICB2YXIga2V5cyA9IGdyYW0udG9rZW5LZXlzO1xuICB2YXIgdG9rZW5zID0gZ3JhbS50b2tlbk1hcDtcbiAgdmFyIHN0cmVhbSA9IFtdO1xuICB2YXIgbGVuID0gaW5wdXQubGVuZ3RoLCBjYW5kaWRhdGUsIGksIGtleSwgY29weSA9IGlucHV0LCBsYXN0VG9rZW4gPSBudWxsO1xuICB2YXIgcG9pbnRlciA9IDA7XG4gIHZhciBsaW5lID0gMDtcbiAgdmFyIGNvbHVtbiA9IDA7XG5cbiAgd2hpbGUocG9pbnRlciA8IGxlbikge1xuICAgIGNhbmRpZGF0ZSA9IG51bGw7XG4gICAgZm9yKGk9MDsgaTxrZXlzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBrZXkgPSBrZXlzW2ldO1xuICAgICAgdmFyIHRva2VuID0gdG9rZW5zW2tleV0sIG1hdGNoO1xuICAgICAgaWYodG9rZW4uZnVuYykge1xuICAgICAgICBtYXRjaCA9IHRva2VuLmZ1bmMoaW5wdXQsIHN0cmVhbSk7XG4gICAgICAgIGlmKG1hdGNoICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBjYW5kaWRhdGUgPSBtYXRjaDtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmKHRva2VuLnJlZyl7XG4gICAgICAgIG1hdGNoID0gaW5wdXQubWF0Y2godG9rZW4ucmVnKTtcbiAgICAgICAgaWYobWF0Y2ggIT09IG51bGwpIHtcbiAgICAgICAgICBjYW5kaWRhdGUgPSBtYXRjaFswXTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVG9rZW5pemVyIGVycm9yOiBJbnZhbGlkIHRva2VuIFwiICsga2V5ICsgXCIgd2l0aG91dCBhIHJlZyBvciBmdW5jIHByb3BlcnR5XCIpO1xuICAgICAgfVxuICAgIH1cbiAgICBpZihjYW5kaWRhdGUgIT09IG51bGwpIHtcbiAgICAgIGxhc3RUb2tlbiA9IHt0eXBlOmtleSwgdmFsdWU6Y2FuZGlkYXRlLCBwb2ludGVyOnBvaW50ZXIsIGxpbmU6bGluZSsxLCBjb2x1bW46Y29sdW1uKzF9O1xuICAgICAgc3RyZWFtLnB1c2gobGFzdFRva2VuKTtcbiAgICAgIHZhciBsaW5lX2JyZWFrc19jb3VudCA9IGNvdW50TGluZUJyZWFrKGNhbmRpZGF0ZSk7XG4gICAgICBsaW5lICs9IGxpbmVfYnJlYWtzX2NvdW50O1xuICAgICAgaWYobGluZV9icmVha3NfY291bnQgPiAwKSB7XG4gICAgICAgIGNvbHVtbiA9IDA7XG4gICAgICB9XG4gICAgICBjb2x1bW4gKz0gY291bnRDb2x1bW4oY2FuZGlkYXRlKTtcbiAgICAgIHBvaW50ZXIgKz0gY2FuZGlkYXRlLmxlbmd0aDtcbiAgICAgIGlucHV0ID0gaW5wdXQuc3Vic3RyKGNhbmRpZGF0ZS5sZW5ndGgpO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZihzdHJlYW0ubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlRva2VuaXplciBlcnJvcjogdG90YWwgbWF0Y2ggZmFpbHVyZVwiKTtcbiAgICAgIH1cbiAgICAgIGlmKGxhc3RUb2tlbilcbiAgICAgICAgbGFzdFRva2VuLnBvaW50ZXIgKz0gbGFzdFRva2VuLnZhbHVlLmxlbmd0aDtcbiAgICAgIHZhciBtc2cgPSBlcnJvck1zZyhjb3B5LCBzdHJlYW1bc3RyZWFtLmxlbmd0aCAtIDFdLCBcIlRva2VuaXplciBlcnJvclwiLCBcIk5vIG1hdGNoaW5nIHRva2VuIGZvdW5kXCIpO1xuICAgICAgaWYobGFzdFRva2VuKVxuICAgICAgICBtc2cgKz0gXCJcXG5cIiArIFwiQmVmb3JlIHRva2VuIG9mIHR5cGUgXCIgKyBsYXN0VG9rZW4udHlwZSArIFwiOiBcIiArIGxhc3RUb2tlbi52YWx1ZTtcbiAgICAgIHRocm93IG5ldyBFcnJvcihtc2cpO1xuICAgIH1cbiAgfVxuICBzdHJlYW0ucHVzaCh7dHlwZTonRU9GJywgdmFsdWU6XCJcIn0pO1xuICByZXR1cm4gc3RyZWFtO1xufVxuXG5mdW5jdGlvbiBjb3VudExpbmVCcmVhayhzdHIpIHtcbiAgdmFyIG0gPSBzdHIuc3BsaXQoL1xcbi9nKTtcbiAgcmV0dXJuIG0ubGVuZ3RoIC0gMTtcbn1cblxuZnVuY3Rpb24gY291bnRDb2x1bW4oc3RyKSB7XG4gIHZhciBtID0gc3RyLnNwbGl0KC9cXG4vZyk7XG4gIHJldHVybiBtW20ubGVuZ3RoLTFdLmxlbmd0aDtcbn1cblxuZnVuY3Rpb24gY29weVRva2VuKHN0b2tlbiwgcnRva2VuKSB7XG4gIHZhciB0ID0ge1xuICAgIHR5cGU6c3Rva2VuLnR5cGUsXG4gICAgdmFsdWU6c3Rva2VuLnZhbHVlLFxuICAgIHJlcGVhdDpydG9rZW4ucmVwZWF0LFxuICAgIGxpbmU6c3Rva2VuLmxpbmUsXG4gICAgY29sdW1uOnN0b2tlbi5jb2x1bW5cbiAgfTtcbiAgaWYocnRva2VuLm5hbWUpIHtcbiAgICB0Lm5hbWUgPSBydG9rZW4ubmFtZTtcbiAgfVxuICByZXR1cm4gdDtcbn1cblxuZnVuY3Rpb24gY3JlYXRlUGFyYW1zKHRva2Vucykge1xuICB2YXIgcGFyYW1zID0ge307XG4gIHZhciBqID0gMDtcbiAgdG9rZW5zLm1hcChmdW5jdGlvbihpKSB7XG4gICAgaWYoaS5uYW1lKSB7XG4gICAgICBpZihpLnJlcGVhdCA9PSAnKicgfHwgaS5yZXBlYXQgPT0gJysnKSB7XG4gICAgICAgIGlmKCFwYXJhbXNbaS5uYW1lXSkge1xuICAgICAgICAgIHBhcmFtc1tpLm5hbWVdID0gW107XG4gICAgICAgIH1cbiAgICAgICAgcGFyYW1zW2kubmFtZV0ucHVzaChpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHBhcmFtc1tpLm5hbWVdID0gaTtcbiAgICAgIH1cbiAgICB9XG4gICAgcGFyYW1zWyckJytqXSA9IGk7XG4gICAgaisrO1xuICB9KTtcbiAgcmV0dXJuIHBhcmFtcztcbn1cblxuZnVuY3Rpb24gZ3Jvd0xSKGdyYW1tYXIsIHJ1bGUsIHN0cmVhbSwgcG9zLCBtZW1vKSB7XG4gIHZhciBzcCwgcmVzdWx0LCBwcm9ncmVzcyA9IGZhbHNlO1xuICB2YXIgaG9vayA9IGdyYW1tYXJbcnVsZS5rZXldLmhvb2tzW3J1bGUuaW5kZXhdO1xuXG4gIHdoaWxlKHRydWUpIHtcbiAgICBzcCA9IHBvcztcblxuICAgIHJlc3VsdCA9IGV2YWxSdWxlQm9keShncmFtbWFyLCBydWxlLCBzdHJlYW0sIHNwKTtcblxuICAgIC8vIGVuc3VyZSBzb21lIHByb2dyZXNzIGlzIG1hZGVcbiAgICBpZihyZXN1bHQgPT09IGZhbHNlIHx8IHJlc3VsdC5zcCA8PSBtZW1vLnNwKSB7XG4gICAgICByZXR1cm4gcHJvZ3Jlc3M7XG4gICAgfVxuXG4gICAgcmVzdWx0Lmhvb2sgPSBob29rO1xuXG4gICAgLy8gaXQncyB2ZXJ5IGltcG9ydGFudCB0byB1cGRhdGUgdGhlIG1lbW9pemVkIHZhbHVlXG4gICAgLy8gdGhpcyBpcyBhY3R1YWxseSBncm93aW5nIHRoZSBzZWVkIGluIHRoZSBtZW1vaXphdGlvblxuICAgIG1lbW8uY2hpbGRyZW4gPSByZXN1bHQuY2hpbGRyZW47XG4gICAgbWVtby5zcCA9IHJlc3VsdC5zcDtcbiAgICBtZW1vLmxpbmUgPSByZXN1bHQubGluZTtcbiAgICBtZW1vLmNvbHVtbiA9IHJlc3VsdC5jb2x1bW47XG4gICAgbWVtby5zdGFydCA9IHJlc3VsdC5zdGFydDtcbiAgICBtZW1vLmhvb2tlZCA9IHJlc3VsdC5ob29rZWQ7XG4gICAgbWVtby5ob29rID0gcmVzdWx0Lmhvb2s7XG4gICAgcHJvZ3Jlc3MgPSByZXN1bHQ7XG4gIH1cbiAgcmV0dXJuIHByb2dyZXNzO1xufVxuXG5mdW5jdGlvbiBtZW1vRXZhbChncmFtbWFyLCBydWxlLCBzdHJlYW0sIHBvaW50ZXIpIHtcblxuICB2YXIga2V5ID0gcnVsZS5rZXkrJzsnK3BvaW50ZXIrJzsnK3J1bGUuaW5kZXg7XG5cbiAgLy8gYXZvaWQgaW5maW5pdGUgcmVjdXJzaW9uXG4gIC8vIFRoaXMgaXMgZmFzdGVyIHRoYW4gZmlsdGVyXG4gIHZhciBpID0gc3RhY2subGVuZ3RoIC0gMTtcbiAgd2hpbGUoaSA+PSAwKSB7XG4gICAgaWYoc3RhY2tbaV1bMF0gPT0ga2V5KSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGkgPSBpLTE7XG4gIH1cblxuICB2YXIgbWVtb19lbnRyeSA9IG1lbW9pemF0aW9uW3J1bGUua2V5Kyc7Jytwb2ludGVyXTtcbiAgaWYobWVtb19lbnRyeSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIG1lbW9fZW50cnk7XG4gIH1cblxuICBzdGFjay5wdXNoKFtrZXksIHJ1bGVdKTtcbiAgdmFyIHJlc3VsdCA9IGV2YWxSdWxlQm9keShncmFtbWFyLCBydWxlLCBzdHJlYW0sIHBvaW50ZXIpO1xuICBzdGFjay5wb3AoKTtcblxuICByZXR1cm4gcmVzdWx0O1xufVxuXG5mdW5jdGlvbiBjYW5GYWlsKHRva2VuLCBub2RlKSB7XG4gIGlmKHRva2VuLnJlcGVhdCA9PT0gJyonIHx8IHRva2VuLnJlcGVhdCA9PT0gJz8nKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cbiAgaWYodG9rZW4ucmVwZWF0ID09PSAnKycgJiYgbm9kZS5jaGlsZHJlbi5sZW5ndGggJiYgbm9kZS5jaGlsZHJlbltub2RlLmNoaWxkcmVuLmxlbmd0aCAtIDFdLnR5cGUgPT0gdG9rZW4udHlwZSkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuZnVuY3Rpb24gY2FuUmVwZWF0KHRva2VuKSB7XG4gIHJldHVybiB0b2tlbi5yZXBlYXQgPT09ICcqJyB8fCB0b2tlbi5yZXBlYXQgPT09ICcrJztcbn1cblxuZnVuY3Rpb24gZXZhbFJ1bGVCb2R5KGdyYW1tYXIsIHJ1bGUsIHN0cmVhbSwgcG9pbnRlcikge1xuXG4gIHZhciBzcCA9IHBvaW50ZXI7IC8vIHN0cmVhbSBwb2ludGVyXG4gIHZhciBycCA9IDA7ICAgICAgIC8vIHJ1bGUgcG9pbnRlclxuICB2YXIgaiwgcmVzdWx0O1xuXG4gIHZhciBydG9rZW4gPSBydWxlLnRva2Vuc1tycF07XG4gIHZhciBzdG9rZW4gPSBzdHJlYW1bc3BdO1xuXG4gIHZhciBjdXJyZW50Tm9kZSA9IHtcbiAgICB0eXBlOiBydWxlLmtleSwgXG4gICAgY2hpbGRyZW46W10sIFxuICAgIHN0YXJ0OnBvaW50ZXIsIFxuICAgIG5hbWU6cnVsZS5uYW1lLCBcbiAgICBsaW5lOnN0b2tlbi5saW5lLCBcbiAgICBjb2x1bW46c3Rva2VuLmNvbHVtblxuICB9O1xuXG4gIHdoaWxlKHJ0b2tlbiAmJiBzdG9rZW4pIHtcblxuICAgIC8vIENhc2Ugb25lOiB3ZSBoYXZlIGEgcnVsZSB3ZSBuZWVkIHRvIGRldmVsb3BcbiAgICBpZihncmFtbWFyW3J0b2tlbi50eXBlXSkge1xuXG4gICAgICB2YXIgZXhwYW5kX3J1bGVzID0gZ3JhbW1hcltydG9rZW4udHlwZV0ucnVsZXM7XG4gICAgICB2YXIgaG9va3MgPSBncmFtbWFyW3J0b2tlbi50eXBlXS5ob29rcztcbiAgICAgIHJlc3VsdCA9IGZhbHNlO1xuXG4gICAgICB2YXIgbSA9IG1lbW9pemF0aW9uW3J0b2tlbi50eXBlKyc7JytzcF07XG4gICAgICBpZihtKSB7XG4gICAgICAgIHJlc3VsdCA9IG07XG4gICAgICB9XG5cbiAgICAgIGlmKCFyZXN1bHQpIHtcbiAgICAgICAgZm9yKGo9MDsgajxleHBhbmRfcnVsZXMubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgICB2YXIgciA9IGV4cGFuZF9ydWxlc1tqXSwgaG9vayA9IGhvb2tzW2pdO1xuXG4gICAgICAgICAgcmVzdWx0ID0gbWVtb0V2YWwoZ3JhbW1hciwgciwgc3RyZWFtLCBzcCk7XG5cbiAgICAgICAgICBpZihyZXN1bHQpIHtcblxuICAgICAgICAgICAgcmVzdWx0Lmhvb2sgPSBob29rO1xuXG4gICAgICAgICAgICBtZW1vaXphdGlvbltyLmtleSsnOycrc3BdID0gcmVzdWx0O1xuXG4gICAgICAgICAgICBpZihydG9rZW4ucmVwZWF0ID09PSBmYWxzZSkge1xuICAgICAgICAgICAgICB2YXIgbl9yZXN1bHQgPSBncm93TFIoZ3JhbW1hciwgcnVsZSwgc3RyZWFtLCBzcCwgcmVzdWx0KTtcbiAgICAgICAgICAgICAgaWYobl9yZXN1bHQgIT09IGZhbHNlKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG5fcmVzdWx0O1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYocmVzdWx0KSB7XG4gICAgICAgIHNwID0gcmVzdWx0LnNwO1xuICAgICAgICBjdXJyZW50Tm9kZS5jaGlsZHJlbi5wdXNoKHtcbiAgICAgICAgICAgIHR5cGU6IHJ0b2tlbi50eXBlLFxuICAgICAgICAgICAgY2hpbGRyZW46IHJlc3VsdC5jaGlsZHJlbixcbiAgICAgICAgICAgIHNwOnJlc3VsdC5zcCxcbiAgICAgICAgICAgIGxpbmU6IHJlc3VsdC5saW5lLFxuICAgICAgICAgICAgY29sdW1uOiByZXN1bHQuY29sdW1uLFxuICAgICAgICAgICAgaG9vazogcmVzdWx0Lmhvb2ssXG4gICAgICAgICAgICBuYW1lOiBydG9rZW4ubmFtZSxcbiAgICAgICAgICAgIHJlcGVhdDogcnRva2VuLnJlcGVhdCxcbiAgICAgICAgICB9KTtcbiAgICAgICAgaWYoIWNhblJlcGVhdChydG9rZW4pKSB7XG4gICAgICAgICAgcnArKztcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYoIWNhbkZhaWwocnRva2VuLCBjdXJyZW50Tm9kZSkpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgcnArKztcbiAgICAgIH1cblxuICAgIC8vIENhc2UgdHdvOiB3ZSBoYXZlIGEgcHJvcGVyIHRva2VuXG4gICAgfSBlbHNlIHtcbiAgICAgIGlmKHN0b2tlbi50eXBlID09PSBydG9rZW4udHlwZSkge1xuICAgICAgICAvL2N1cnJlbnROb2RlLmNoaWxkcmVuLnB1c2goY29weVRva2VuKHN0b2tlbiwgcnRva2VuKSk7XG4gICAgICAgIGlmKCFydG9rZW4ubm9uQ2FwdHVyaW5nKSB7XG4gICAgICAgICAgY3VycmVudE5vZGUuY2hpbGRyZW4ucHVzaChjb3B5VG9rZW4oc3Rva2VuLCBydG9rZW4pKTtcbiAgICAgICAgICBzcCsrO1xuICAgICAgICB9XG4gICAgICAgIGlmKCFjYW5SZXBlYXQocnRva2VuKSkge1xuICAgICAgICAgIHJwKys7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmKCFjYW5GYWlsKHJ0b2tlbiwgY3VycmVudE5vZGUpKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIHJwKys7XG4gICAgICB9XG5cbiAgICB9XG5cbiAgICAvLyBpbmZvcm1hdGlvbiB1c2VkIGZvciBkZWJ1Z2dpbmcgcHVycG9zZVxuICAgIGlmKGJlc3RfcCA9PT0gc3ApIHtcbiAgICAgIGJlc3RfcGFyc2UuY2FuZGlkYXRlcy5wdXNoKFtydWxlLCBydWxlLnRva2Vuc1tycF1dKTtcbiAgICB9XG4gICAgaWYoYmVzdF9wIDwgc3ApIHtcbiAgICAgIGJlc3RfcGFyc2UgPSB7c3A6c3AsIGNhbmRpZGF0ZXM6W1tydWxlLCBydWxlLnRva2Vuc1tycF1dXX07XG4gICAgICBiZXN0X3AgPSBzcDtcbiAgICB9XG5cbiAgICAvLyBmZXRjaCBuZXh0IHJ1bGUgYW5kIHN0cmVhbSB0b2tlblxuICAgIHJ0b2tlbiA9IHJ1bGUudG9rZW5zW3JwXTtcbiAgICBzdG9rZW4gPSBzdHJlYW1bc3BdO1xuXG4gICAgLy8gcnVsZSBzYXRpc2ZpZWRcbiAgICBpZihydG9rZW4gPT09IHVuZGVmaW5lZCkge1xuICAgICAgY3VycmVudE5vZGUuc3AgPSBzcDtcbiAgICAgIGN1cnJlbnROb2RlLnJwID0gcnA7XG4gICAgICByZXR1cm4gY3VycmVudE5vZGU7XG4gICAgfVxuXG4gICAgLy8gbm8gbW9yZSB0b2tlbnNcbiAgICBpZihzdG9rZW4gPT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYoY2FuRmFpbChydG9rZW4sIGN1cnJlbnROb2RlKSkge1xuICAgICAgICAvLyBUaGlzIGRvZXMgbm90IGhhcHBlbiBvZnRlbiBiZWNhdXNlIG9mIEVPRixcbiAgICAgICAgLy8gQXMgaXQgc3RhbmRzIHRoZSBsYXN0IHRva2VuIGFzIGFsd2F5cyB0byBiZSBFT0ZcbiAgICAgICAgY3VycmVudE5vZGUuc3AgPSBzcDtcbiAgICAgICAgY3VycmVudE5vZGUucnAgPSBycDtcbiAgICAgICAgcmV0dXJuIGN1cnJlbnROb2RlO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICB9IC8vIGVuZCBydWxlIGJvZHkgbG9vcFxuXG4gIHJldHVybiBmYWxzZTtcbn1cblxuZnVuY3Rpb24gc3BsaXRUcmltKGwsIHNwbGl0KSB7XG4gIHJldHVybiBsLnNwbGl0KHNwbGl0KS5tYXAoZnVuY3Rpb24oaSl7IHJldHVybiBpLnRyaW0oKTsgfSk7XG59XG5cbmZ1bmN0aW9uIGdyYW1tYXJUb2tlbih0b2tlbikge1xuICB2YXIgbm9uQ2FwdHVyaW5nID0gdG9rZW4uY2hhckF0KDApID09PSAnISc7XG4gIGlmKG5vbkNhcHR1cmluZykge1xuICAgIHRva2VuID0gdG9rZW4uc3Vic3RyKDEpO1xuICB9XG4gIHZhciByZXBlYXQgPSB0b2tlbi5jaGFyQXQodG9rZW4ubGVuZ3RoIC0gMSk7XG4gIGlmKHJlcGVhdCA9PT0gJyonIHx8IHJlcGVhdCA9PT0gJz8nIHx8IHJlcGVhdCA9PT0gJysnKSB7XG4gICAgdG9rZW4gPSB0b2tlbi5zdWJzdHIoMCwgdG9rZW4ubGVuZ3RoIC0gMSk7XG4gIH0gZWxzZSB7XG4gICAgcmVwZWF0ID0gZmFsc2U7XG4gIH1cbiAgdmFyIG5hbWVkID0gdG9rZW4uc3BsaXQoXCI6XCIpLCB0O1xuICBpZihuYW1lZC5sZW5ndGggPT09IDIpIHtcbiAgICB0ID0ge1xuICAgICAgJ3R5cGUnOiBuYW1lZFsxXSxcbiAgICAgICduYW1lJyA6bmFtZWRbMF1cbiAgICB9O1xuICB9IGVsc2Uge1xuICAgIHQgPSB7J3R5cGUnOiB0b2tlbiB9O1xuICB9XG4gIHQucmVwZWF0ID0gcmVwZWF0O1xuICBpZigocmVwZWF0ID09PSAnKicgfHwgcmVwZWF0ID09PSAnKycpICYmIG5vbkNhcHR1cmluZykge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkltcG9zc2libGUgdG8gaGF2ZSBub24gY2FwdHVyaW5nIHRva2VuIHRoYXQgcmVwZWF0c1wiKTtcbiAgfVxuICBpZihub25DYXB0dXJpbmcpIHtcbiAgICB0Lm5vbkNhcHR1cmluZyA9IG5vbkNhcHR1cmluZztcbiAgfVxuICByZXR1cm4gdDtcbn1cblxuZnVuY3Rpb24gY29tcGlsZUdyYW1tYXIoZ3JhbW1hciwgdG9rZW5EZWYpIHtcbiAgdmFyIGtleXMgPSBPYmplY3Qua2V5cyhncmFtbWFyKSwgaSwgaiwgaztcbiAgdmFyIGdyYW0gPSB7fSwgb3B0aW9uYWwsIG5vbkNhcHR1cmluZztcblxuICBncmFtLnRva2VuRGVmID0gdG9rZW5EZWY7XG4gIGdyYW0udG9rZW5LZXlzID0gW107XG4gIGdyYW0udG9rZW5NYXAgPSB7fTtcbiAgdG9rZW5EZWYubWFwKGZ1bmN0aW9uKHQpIHtcbiAgICBncmFtLnRva2VuTWFwW3Qua2V5XSA9IHQ7XG4gICAgZ3JhbS50b2tlbktleXMucHVzaCh0LmtleSk7XG4gIH0pO1xuXG4gIHZhciBhbGxWYWxpZEtleXMgPSBrZXlzLmNvbmNhdChncmFtLnRva2VuS2V5cyk7XG5cbiAgZm9yKGk9MDsgaTxrZXlzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIGxpbmUgPSBncmFtbWFyW2tleXNbaV1dO1xuICAgIHZhciBrZXkgPSBrZXlzW2ldO1xuICAgIHZhciBydWxlcyA9IGxpbmUucnVsZXM7XG4gICAgdmFyIGhvb2tzID0gW107XG5cbiAgICB2YXIgc3BsaXR0ZWRfcnVsZXMgPSBbXTtcblxuICAgIGZvcihqPTA7IGo8cnVsZXMubGVuZ3RoOyBqKyspIHtcbiAgICAgIHZhciB0b2tlbnMgPSBzcGxpdFRyaW0ocnVsZXNbal0sICcgJyk7XG4gICAgICBvcHRpb25hbCA9IDA7XG4gICAgICBmb3Ioaz0wOyBrPHRva2Vucy5sZW5ndGg7IGsrKykge1xuICAgICAgICB2YXIgdG9rZW4gPSB0b2tlbnNba10gPSBncmFtbWFyVG9rZW4odG9rZW5zW2tdKTtcbiAgICAgICAgaWYoYWxsVmFsaWRLZXlzLmluZGV4T2YodG9rZW4udHlwZSkgPT09IC0xICYmIHRva2VuLnR5cGUgIT09ICdFT0YnKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiSW52YWxpZCB0b2tlbiB0eXBlIHVzZWQgaW4gdGhlIGdyYW1tYXIgcnVsZSBcIitrZXkrXCI6IFwiICsgdG9rZW4udHlwZSArICcsIHZhbGlkIHRva2VucyBhcmU6ICcrYWxsVmFsaWRLZXlzLmpvaW4oJywgJykpO1xuICAgICAgICB9XG4gICAgICAgIGlmKHRva2VuLnJlcGVhdCA9PT0gJyonKSB7XG4gICAgICAgICAgb3B0aW9uYWwgKz0gMTtcbiAgICAgICAgfVxuICAgICAgICBpZih0b2tlbi5ub25DYXB0dXJpbmcpIHtcbiAgICAgICAgICBpZih0b2tlbnNbdG9rZW5zLmxlbmd0aCAtIDFdICE9IHRva2Vuc1trXSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQSBub24gY2FwdHVyaW5nIHRva2VuIGNhbiBvbmx5IGJlIHRoZSBsYXN0IG9uZSBpbiB0aGUgcnVsZTogXCIgKyB0b2tlbi50eXBlKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmKG9wdGlvbmFsID09PSB0b2tlbnMubGVuZ3RoKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlJ1bGUgXCIgKyBydWxlc1tqXSArIFwiIG9ubHkgaGFzIG9wdGlvbmFsIGdyZWVkeSB0b2tlbnMuXCIpO1xuICAgICAgfVxuICAgICAgc3BsaXR0ZWRfcnVsZXMucHVzaCh7a2V5OiBrZXksIGluZGV4OmosIHRva2Vuczp0b2tlbnN9KTtcbiAgICAgIGlmKHR5cGVvZiBsaW5lLmhvb2tzID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgaG9va3MucHVzaChsaW5lLmhvb2tzKTtcbiAgICAgIH0gZWxzZSBpZihsaW5lLmhvb2tzKSB7XG4gICAgICAgIGlmKGxpbmUuaG9va3Nbal0gPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIkluY29ycmVjdCBudW1iZXIgb2YgaG9va3MgYXIgcnVsZSBcIiArIGtleXNbaV0pOyBcbiAgICAgICAgfVxuICAgICAgICBob29rcy5wdXNoKGxpbmUuaG9va3Nbal0pO1xuICAgICAgfVxuICAgIH1cbiAgICBncmFtW2tleV0gPSB7cnVsZXM6IHNwbGl0dGVkX3J1bGVzLCBob29rczogaG9va3MgfHwgW10sIHZlcmJvc2U6bGluZS52ZXJib3NlfTtcbiAgfVxuICBncmFtLnBhcnNlID0gZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgcmV0dXJuIHBhcnNlKHN0cmVhbSwgZ3JhbSk7XG4gIH07XG4gIHJldHVybiBncmFtO1xufVxuXG5mdW5jdGlvbiBzcGFjZXIobikge1xuICB2YXIgb3V0ID0gXCJcIjtcbiAgZm9yKHZhciBpPTA7IGk8bjsgaSsrKSB7XG4gICAgb3V0ICs9IFwiIFwiO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbmZ1bmN0aW9uIGVycm9yTXNnKGlucHV0LCB0b2tlbiwgZXJyb3JUeXBlLCBtKSB7XG5cbiAgdmFyIGNoYXJuID0gdG9rZW4ucG9pbnRlciB8fCAwO1xuICB2YXIgbGluZXMgPSBpbnB1dC5zcGxpdChcIlxcblwiKSwgaSwgY2hhckNvdW50ZXIgPSAwLCBjaGFyT25MaW5lID0gMDtcblxuICBmb3IoaT0wOyBpPGxpbmVzLmxlbmd0aDsgaSsrKSB7XG4gICAgY2hhckNvdW50ZXIgKz0gbGluZXNbaV0ubGVuZ3RoICsgMTtcbiAgICBpZihjaGFyQ291bnRlciA+PSBjaGFybikge1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGNoYXJPbkxpbmUgKz0gbGluZXNbaV0ubGVuZ3RoICsgMTtcbiAgfVxuXG4gIHZhciBsbiA9IE1hdGgubWF4KDAsIGkpOyAvLyBsaW5lIG51bWJlclxuICB2YXIgbXNnID0gZXJyb3JUeXBlICsgXCIgYXQgbGluZSBcIisobG4rMSkrXCIgY2hhciBcIisgKGNoYXJuIC0gY2hhck9uTGluZSkgK1wiOiBcIjtcbiAgdmFyIGluZGljYXRvciA9IFwiXFxuXCIgKyBzcGFjZXIoKGNoYXJuIC0gY2hhck9uTGluZSkgKyAoKGxuKSArICc6ICcpLmxlbmd0aCk7XG5cbiAgaWYobGluZXNbbG4tMV0gIT09IHVuZGVmaW5lZCkge1xuICAgIG1zZyA9IG1zZyArIFwiXFxuXCIgKyAobG4pICsgJzogJyArIGxpbmVzW2xuLTFdO1xuICB9XG4gIG1zZyA9IG1zZyArIFwiXFxuXCIgKyAobG4rMSkgKyAnOiAnICsgbGluZXNbbG5dICsgaW5kaWNhdG9yO1xuICBtc2cgPSBtc2cgKyBcIl4tLSBcIiArIG07XG5cbiAgaWYobGluZXNbbG4rMV0gIT09IHVuZGVmaW5lZCkge1xuICAgIG1zZyA9IG1zZyArIFwiXFxuXCIgKyAobG4rMikgKyAnOiAnICsgbGluZXNbbG4rMV07XG4gIH1cblxuICByZXR1cm4gbXNnO1xufVxuXG5mdW5jdGlvbiB2ZXJib3NlTmFtZShncmFtbWFyLCB0eXBlKSB7XG4gIHZhciB0b2tlbmRlZiA9IGdyYW1tYXIudG9rZW5NYXBbdHlwZV07XG4gIGlmKHRva2VuZGVmICYmIHRva2VuZGVmLnZlcmJvc2UpIHtcbiAgICByZXR1cm4gdG9rZW5kZWYudmVyYm9zZTtcbiAgfVxuICBpZihncmFtbWFyW3R5cGVdICYmIGdyYW1tYXJbdHlwZV0udmVyYm9zZSkge1xuICAgIHJldHVybiBncmFtbWFyW3R5cGVdLnZlcmJvc2U7XG4gIH1cbiAgcmV0dXJuIHR5cGU7XG59XG5cbmZ1bmN0aW9uIGhpbnQoaW5wdXQsIHN0cmVhbSwgYmVzdF9wYXJzZSwgZ3JhbW1hcikge1xuICBpZighYmVzdF9wYXJzZSB8fCAhYmVzdF9wYXJzZS5jYW5kaWRhdGVzWzBdKSB7XG4gICAgcmV0dXJuIFwiQ29tcGxldGUgZmFpbHVyZSB0byBwYXJzZVwiO1xuICB9XG4gIHZhciBydWxlID0gYmVzdF9wYXJzZS5jYW5kaWRhdGVzWzBdWzBdO1xuXG4gIHZhciBhcnJheSA9IFtdO1xuICBiZXN0X3BhcnNlLmNhbmRpZGF0ZXMubWFwKGZ1bmN0aW9uKHIpIHtcbiAgICBpZighclsxXSkgeyByZXR1cm47IH1cbiAgICB2YXIgbmFtZSA9IHZlcmJvc2VOYW1lKGdyYW1tYXIsIHJbMV0udHlwZSk7XG4gICAgaWYoYXJyYXkuaW5kZXhPZihuYW1lKSA9PT0gLTEpIHtcbiAgICAgIGFycmF5LnB1c2gobmFtZSk7XG4gICAgfVxuICB9KTtcbiAgdmFyIGNhbmRpZGF0ZXMgPSBhcnJheS5qb2luKCcgb3IgJyk7XG5cbiAgdmFyIG1zZyA9IGVycm9yTXNnKGlucHV0LCBzdHJlYW1bYmVzdF9wYXJzZS5zcF0sIFwiUGFyc2VyIGVycm9yXCIsIFwiUnVsZSBcIiArIHZlcmJvc2VOYW1lKGdyYW1tYXIsIHJ1bGUua2V5KSk7XG4gIG1zZyA9IG1zZyArIFwiXFxuRXhwZWN0IFwiICsgY2FuZGlkYXRlcztcbiAgdmFyIGxhc3RUb2tlbiA9IHN0cmVhbVtiZXN0X3BhcnNlLnNwXSB8fCB7dHlwZTpcIkVPRlwifTtcbiAgbXNnID0gbXNnICsgXCJcXG5CdXQgZ290IFwiICsgdmVyYm9zZU5hbWUoZ3JhbW1hciwgbGFzdFRva2VuLnR5cGUpICsgXCIgaW5zdGVhZFwiO1xuXG4gIHJldHVybiBtc2c7XG59XG5cbi8vIHRob3NlIGFyZSBtb2R1bGUgZ2xvYmFsc1xudmFyIHN0YWNrID0gW107XG52YXIgbWVtb2l6YXRpb24gPSB7fTtcbnZhciBiZXN0X3BhcnNlID0gbnVsbDtcbnZhciBiZXN0X3AgPSAwO1xuXG5mdW5jdGlvbiBob29rVHJlZShub2RlKSB7XG4gIGlmKCFub2RlLmNoaWxkcmVuKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIGZvcih2YXIgaT0wOyBpPG5vZGUuY2hpbGRyZW4ubGVuZ3RoOyBpKyspIHtcbiAgICBob29rVHJlZShub2RlLmNoaWxkcmVuW2ldKTtcbiAgfVxuICBpZihub2RlLmhvb2spIHtcbiAgICBub2RlLmNoaWxkcmVuID0gbm9kZS5ob29rKGNyZWF0ZVBhcmFtcyhub2RlLmNoaWxkcmVuKSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcGFyc2UoaW5wdXQsIGdyYW1tYXIpIHtcbiAgdmFyIGJlc3RSZXN1bHQgPSB7dHlwZTonU1RBUlQnLCBzcDowLCBjb21wbGV0ZTpmYWxzZX0sIGksIHJlc3VsdCwgc3RyZWFtO1xuICAvL2lmKHR5cGVvZiBpbnB1dCA9PT0gJ3N0cmluZycpIHtcbiAgc3RyZWFtID0gdG9rZW5pemUoaW5wdXQsIGdyYW1tYXIpO1xuICAvL31cbiAgYmVzdF9wYXJzZSA9IHtzcDowLCBjYW5kaWRhdGVzOltdfTtcbiAgYmVzdF9wID0gMDtcbiAgZm9yKGk9MDsgaTxncmFtbWFyLlNUQVJULnJ1bGVzLmxlbmd0aDsgaSsrKSB7XG4gICAgc3RhY2sgPSBbXTtcbiAgICBtZW1vaXphdGlvbiA9IHt9O1xuICAgIHJlc3VsdCA9IG1lbW9FdmFsKGdyYW1tYXIsIGdyYW1tYXIuU1RBUlQucnVsZXNbaV0sIHN0cmVhbSwgMCk7XG4gICAgaWYocmVzdWx0ICYmIHJlc3VsdC5zcCA+IGJlc3RSZXN1bHQuc3ApIHtcbiAgICAgIGJlc3RSZXN1bHQgPSB7XG4gICAgICAgIHR5cGU6J1NUQVJUJyxcbiAgICAgICAgY2hpbGRyZW46cmVzdWx0LmNoaWxkcmVuLFxuICAgICAgICBzcDogcmVzdWx0LnNwLFxuICAgICAgICBsaW5lOiAxLFxuICAgICAgICBjb2x1bW46IDEsXG4gICAgICAgIGNvbXBsZXRlOnJlc3VsdC5zcCA9PT0gc3RyZWFtLmxlbmd0aCxcbiAgICAgICAgaW5wdXRMZW5ndGg6c3RyZWFtLmxlbmd0aCxcbiAgICAgIH07XG4gICAgfVxuICB9XG4gIGJlc3RSZXN1bHQuYmVzdFBhcnNlID0gYmVzdF9wYXJzZTtcbiAgaG9va1RyZWUoYmVzdFJlc3VsdCk7XG4gIGlmKGJlc3RfcGFyc2UgJiYgIWJlc3RSZXN1bHQuY29tcGxldGUpIHtcbiAgICBiZXN0UmVzdWx0LmhpbnQgPSBoaW50KGlucHV0LCBzdHJlYW0sIGJlc3RfcGFyc2UsIGdyYW1tYXIpO1xuICB9XG4gIHJldHVybiBiZXN0UmVzdWx0O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgcGFyc2U6IHBhcnNlLFxuICBzdGFjazogc3RhY2ssXG4gIGNvbXBpbGVHcmFtbWFyOiBjb21waWxlR3JhbW1hcixcbiAgdG9rZW5pemU6IHRva2VuaXplLFxuICBtZW1vaXphdGlvbjogbWVtb2l6YXRpb25cbn07XG4iXX0=

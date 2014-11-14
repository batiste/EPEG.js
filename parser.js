(function(){

function tokenize(input, tokens) {
  // this keep the order of declaration
  var keys = Object.keys(tokens);
  var stream = [];
  var len = input.length, candidate, i, candidate_key;

  while(len > 0) {
    candidate = null;
    for(i=0; i<keys.length; i++) {
      var key = keys[i];
      var token = tokens[key];
      var match = input.match(token);
      if(match !== null) {
        // the algo is greedy
        if(candidate && candidate.length >= match[0].length) {
          continue;
        }
        candidate = match[0];
        candidate_key = key;
      }
    }
    if(candidate && candidate.length > 0) {
      stream.push({type:candidate_key, value:candidate});
      input = input.substr(candidate.length);
      len = input.length;
    } else {
      throw "No matching token found near " + input.substr(0, 12);
    }
  }
  return stream;
}

function copyToken(stoken, rtoken) {
  if(rtoken.name) {
    return {type:stoken.type,
      value:stoken.value,
      name:rtoken.name,
      repeat:rtoken.repeat};
  }
  return {type:stoken.type,
    value:stoken.value,
    repeat:rtoken.repeat};
}

function createParams(tokens) {
  var params = {};
  tokens.map(function(i) {
    if(i.name) {
      if(i.repeat) {
        if(!params[i.name]) {
          params[i.name] = [];
        }
        params[i.name].push(i);
      } else {
        params[i.name] = i;
      }
    }
  });
  return params;
}

function matchRule(grammar, rule, stream, pointer, parent) {
  var sp = pointer; // stream pointer
  var rp = 0; // rule pointer
  var i, j;
  var parsed = [];

  while(stream[sp] && rule[rp]) {

    var rtoken = rule[rp];
    var stoken = stream[sp];

    if(grammar[rtoken.type]) {

      var expand_rules = grammar[rtoken.type].rules;
      var func = grammar[rtoken.type].func;
      var consume = grammar[rtoken.type].consume;

      // iterate
      var found_one = false;

      for(j=0; j<expand_rules.length; j++) {

        var abort = stack.filter(function(i) {
          if(i[0] == sp && i[1] == rtoken.type && i[2] == j) {
            return true;
          }
        }).length > 1;

        if(abort) {
          return false;
        }

        var new_rule = expand_rules[j];
        var value = null;

        stack.push([sp, rtoken.type, j]);
        result = matchRule(grammar, new_rule, stream, sp);
        stack.pop();

        if(func && result) {
          var params = createParams(result[0]);
          if(params) {
            result[0] = func(params);
          }
        }

        if(result) {
          parsed.push({type:rtoken.type, value:result[0], name:rtoken.name, repeat:rtoken.repeat});
          sp = result[1];
          found_one = true;
          break; // stop at the first found one
        }
      }
      if(found_one) {
        if(rtoken.repeat === false) {
          rp++;
        }
        if(rtoken.repeat === '?') {
          rp++;
        }
      } else {
        if(rtoken.repeat === false) {
          return false;
        }
        rp++;
      }

    } else {

      if(rtoken.repeat == '?') {
        if(stoken.type == rtoken.type) {
          parsed.push(copyToken(stoken, rtoken));
          rp++;
          sp++;
        } else {
          rp++;
        }
      } else if(rtoken.repeat == '*') {
        if(stoken.type == rtoken.type) {
          parsed.push(copyToken(stoken, rtoken));
          sp++;
        } else {
          rp++;
        }
      } else if(rtoken.repeat === false) {
        if(stoken.type == rtoken.type) {
          parsed.push(copyToken(stoken, rtoken));
          sp++;
          rp++;
        } else {
          return false;
        }
      }

    }

    // rule is fullfilled
    if(rule[rp] === undefined) {
      return [parsed, sp];
    }

  }
  return [parsed, sp];
}


function splitTrim(l, split) {
  return l.split(split).map(function(i){ return i.trim(); });
}


function grammarToken(token) {
  var repeat = token.charAt(token.length - 1);
  if(repeat === '*' || repeat === '?' || repeat === '+') {
    token = token.substr(0, token.length - 1);
  } else {
    repeat = false;
  }
  var named = token.split(":");
  if(named.length == 2) {
    return {
      'type': named[1],
      'repeat': repeat,
      'name' :named[0]
    };
  }
  return {
    'type': token,
    'repeat': repeat
  };
}


function compileGrammar(grammar, tokenDef) {
  var keys = Object.keys(grammar);
  var allValidKeys = keys.concat(Object.keys(tokenDef));
  var gram = {};

  for(i=0; i<keys.length; i++) {
    var line = grammar[keys[i]];
    var key = keys[i];
    var rules = line.rules;

    var splitted_rules = [];

    for(j=0; j<rules.length; j++) {
      var tokens = splitTrim(rules[j], ' ');
      tokens = tokens.map(function(t) {
        var token = grammarToken(t);
        if(allValidKeys.indexOf(token.type) == -1) {
          throw "Invalid token type in the grammar: " + token.type;
        }
        return token;
      });
      splitted_rules.push(tokens);
    }

    gram[key] = {rules:splitted_rules, func:line.func, consume:(line.consume || 0)};
  }
  return gram;
}

var stack = []; // TODO: not a global?
function parse(stream, grammar) {
  for(i=0; i<grammar.START.rules.length; i++) {
    stack = [];
    result = matchRule(grammar, grammar.START.rules[i], stream, 0);
    if(result) {
      return {type:'START', value:result[0],
        repeat:false, consumed: result[1],
        complete:result[1] === stream.length};
    }
  }
  return false;
}

window.EPEG = {
  parse: parse,
  stack: stack,
  compileGrammar: compileGrammar,
  tokenize: tokenize
};

})();
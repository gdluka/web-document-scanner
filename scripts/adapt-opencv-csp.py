from pathlib import Path
import hashlib

import argparse
parser = argparse.ArgumentParser(description='Adapt the pinned OpenCV.js 5.0.0 distribution for a CSP without unsafe-eval.')
parser.add_argument('source', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
source = args.source
s = source.read_text()
before = hashlib.sha256(source.read_bytes()).hexdigest()
if before != 'b873c8211421da7b9bf41ae157a923f05a46a0b8d3e5904c44c6f3ad6d39a1bd':
    raise SystemExit('Unexpected upstream bundle; this adaptation supports only 5.0.0-release.1.')
# Static invokers keep the compiled WASM unchanged and avoid runtime Function construction.
# See Emscripten libembind.js/libemval.js DYNAMIC_EXECUTION=0 paths.
a = s.index('function createJsInvoker(')
b = s.index('function craftInvokerFunction(', a)
s = s[:a] + '''function createJsInvoker(argTypes,isClassMethodFunc,returns,isAsync) {
  var needsDestructorStack=usesDestructorStack(argTypes), argCount=argTypes.length-2;
  return function(humanName,throwBindingError,invoker,fn,runDestructors,fromRetWire,toClassParamWire,...converters) {
    return function(...args) {
      var destructors=needsDestructorStack?[]:null, values=[], wired=[fn], cleaned=false;
      function cleanup() {
        if(cleaned) return; cleaned=true;
        if(needsDestructorStack) runDestructors(destructors);
        else for(var i=isClassMethodFunc?1:2;i<argTypes.length;i++) {
          var type=argTypes[i]; if(type.destructorFunction!==null && values[i]!==undefined) type.destructorFunction(values[i]);
        }
      }
      try {
        if(isClassMethodFunc) { values[1]=toClassParamWire(destructors,this); wired.push(values[1]); }
        for(var i=0;i<argCount;i++) { values[i+2]=converters[i](destructors,args[i]); wired.push(values[i+2]); }
        var rv=invoker(...wired);
        if(isAsync && rv instanceof Promise) return rv.then(v=>{cleanup();return returns?fromRetWire(v):undefined},e=>{cleanup();throw e});
        cleanup(); return returns?fromRetWire(rv):undefined;
      } catch(e) { cleanup(); throw e; }
    };
  };
}''' + s[b:]
a = s.index('var __emval_create_invoker=')
b = s.index('var __emval_get_property=', a)
s = s[:a] + '''var __emval_create_invoker=(argCount,argTypesPtr,kind)=>{
  var [retType,...argTypes]=emval_lookupTypes(argCount,argTypesPtr);
  var toReturnWire=retType.toWireType.bind(retType);
  var argFromPtr=argTypes.map(type=>type.readValueFromPointer.bind(type));
  var invokerFunction=(handle,methodName,destructorsRef,args)=>{
    var argv=argFromPtr.map((convert,i)=>convert(args+i*8)), rv;
    switch(kind) {
      case 0:rv=Emval.toValue(handle).apply(null,argv);break;
      case 2:rv=Reflect.construct(Emval.toValue(handle),argv);break;
      case 3:rv=argv[0];break;
      case 1:rv=Emval.toValue(handle)[getStringOrSymbol(methodName)](...argv);break;
      default:throw new Error('Unknown emval invoker kind');
    }
    if(!retType.isVoid) return emval_returnValue(toReturnWire,destructorsRef,rv);
  };
  return emval_addMethodCaller(createNamedFunction('static emval method caller',invokerFunction));
};''' + s[b:]
assert 'new Function' not in s
output=args.output
output.write_text(s.rstrip() + "\n")
print('Original SHA256:', before)
print('Adapted SHA256:', hashlib.sha256(output.read_bytes()).hexdigest())
print('Static adaptation bytes:', output.stat().st_size)

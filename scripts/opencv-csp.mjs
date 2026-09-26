// @techstark/opencv-js 4.10.0: replace Emscripten's dynamic wrappers
// with equivalent closures. Fail closed if an upgrade changes these factories.
export function makeOpenCvCspSafe(source) {
  const replacements = [
    [/function craftInvokerFunction\(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc\)\{[\s\S]*?(?=function heap32VectorToArray\()/g,
      `function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc){
        if(argTypes.length<2)throwBindingError("argTypes array size mismatch!");
        var isMethod=argTypes[1]!==null&&classType!==null;
        var needsStack=argTypes.slice(1).some(function(t){return t!==null&&t.destructorFunction===undefined});
        var wrapper=function(){
          if(arguments.length!==argTypes.length-2)throwBindingError("function "+humanName+" called with invalid number of arguments");
          var destructors=needsStack?[]:null;
          var wired=[], types=[];
          if(isMethod){wired.push(argTypes[1].toWireType(destructors,this));types.push(argTypes[1])}
          for(var i=2;i<argTypes.length;i++){
            wired.push(argTypes[i].toWireType(destructors,arguments[i-2]));types.push(argTypes[i]);
          }
          var rv=cppInvokerFunc.apply(undefined,[cppTargetFunc].concat(wired));
          if(needsStack)runDestructors(destructors);
          else for(var i=0;i<types.length;i++){
            var dtor=types[i].destructorFunction;if(dtor!==null)dtor(wired[i]);
          }
          if(argTypes[0].name!=="void")return argTypes[0].fromWireType(rv);
        };
        Object.defineProperty(wrapper,"name",{value:makeLegalFunctionName(humanName)});
        Object.defineProperty(wrapper,"length",{value:argTypes.length-2});
        return wrapper;
      }`],
    [/function __emval_get_method_caller\(argCount,argTypes\)\{[\s\S]*?(?=function __emval_get_property\()/g,
      `function __emval_get_method_caller(argCount,argTypes){
        var types=__emval_lookupTypes(argCount,argTypes),retType=types[0];
        return __emval_addMethodCaller(function(handle,name,destructors,args){
          var values=[],offset=0;
          for(var i=1;i<argCount;i++){
            values.push(types[i].readValueFromPointer(args+offset));offset+=types[i].argPackAdvance;
          }
          var rv=handle[name].apply(handle,values);
          for(var i=1;i<argCount;i++)if(types[i].deleteObject)types[i].deleteObject(values[i-1]);
          if(!retType.isVoid)return retType.toWireType(destructors,rv);
        });
      }`],
    [/function createNamedFunction\(name,body\)\{[\s\S]*?(?=function extendError\()/g,
      `function createNamedFunction(name,body){
        var wrapper=function(){"use strict";return body.apply(this,arguments)};
        Object.defineProperty(wrapper,"name",{value:makeLegalFunctionName(name)});
        return wrapper;
      }`],
    [/function makeDynCaller\(dynCall\)\{[\s\S]*?(?=var fp;)/g,
      `function makeDynCaller(dynCall){
        var arity=signature.length-1;
        var wrapper=function(){
          var args=[rawFunction];
          for(var i=0;i<arity;i++)args.push(arguments[i]);
          return dynCall.apply(undefined,args);
        };
        Object.defineProperty(wrapper,"name",{value:"dynCall_"+signature+"_"+rawFunction});
        Object.defineProperty(wrapper,"length",{value:arity});
        return wrapper;
      }`],
  ];
  for (const [pattern, replacement] of replacements) {
    if ([...source.matchAll(pattern)].length !== 1) {
      throw new Error("OpenCV CSP adapter needs review after dependency change");
    }
    source = source.replace(pattern, () => replacement);
  }
  if (/new Function\s*\(|\beval\s*\(|new_\(Function/.test(source)) {
    throw new Error("OpenCV still contains dynamic JavaScript execution");
  }
  return source;
}

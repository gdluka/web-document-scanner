import { describe, expect, it } from 'vitest'
import { detectCurvedGuides, fillCombinedCurvatureMaps, fitCubicQR } from './curvedTableGeometry'
const identity=[1,0,0,0,1,0,0,0,1]
describe('combined document curvature geometry',()=>{
 it('fits a cubic with QR and rejects a singular fit',()=>{
  const xs=Array.from({length:45},(_,i)=>i/44)
  const coefficients=fitCubicQR(xs,xs.map(x=>10+2*x-3*x*x+5*x*x*x))!
  for(const [i,expected] of [10,2,-3,5].entries()) expect(coefficients[i]).toBeCloseTo(expected,8)
  expect(fitCubicQR([1,1,1,1],[0,1,2,3])).toBeNull()
 })
 it('detects locally curved rules rather than treating them as straight Hough lines',()=>{
  const width=400,height=600,rules=new Uint8Array(width*height)
  for(let base=80;base<540;base+=60) for(let x=0;x<width;x++){
   const y=Math.round(base+12*(x/width-.5)**2)
   rules[y*width+x]=rules[(y+1)*width+x]=255
  }
  const guides=detectCurvedGuides(rules,width,height)
  expect(guides.length).toBeGreaterThanOrEqual(7)
  const mapX=new Float32Array(width*height),mapY=new Float32Array(width*height)
  expect(fillCombinedCurvatureMaps(guides,width,height,identity,mapX,mapY)).toBeGreaterThan(.2)
  expect(mapY[80*width]).toBeGreaterThan(mapY[80*width+200]!)
 })
 it('composes the inverse perspective directly with the curvature map',()=>{
  const width=80,height=120,guides=[20,40,60,80].map(y=>({coefficients:[y,0,0,0],targetY:y}))
  const x=new Float32Array(width*height),y=new Float32Array(width*height)
  expect(fillCombinedCurvatureMaps(guides,width,height,[2,0,10,0,2,20,0,0,1],x,y)).toBeCloseTo(1)
  expect(x[60*width+40]).toBeCloseTo(15);expect(y[60*width+40]).toBeCloseTo(20)
 })
 it('rejects crossing, excessive compression, nonfinite coefficients and singular homographies',()=>{
  const width=80,height=120,guides=[20,40,60,80].map(y=>({coefficients:[y,0,0,0],targetY:y}))
  const x=new Float32Array(width*height),y=new Float32Array(width*height)
  expect(fillCombinedCurvatureMaps([...guides.slice(0,2),{coefficients:[30,0,0,0],targetY:60},guides[3]!],width,height,identity,x,y)).toBeNull()
  expect(fillCombinedCurvatureMaps([{coefficients:[1,0,0,0],targetY:20},...guides.slice(1)],width,height,identity,x,y)).toBeNull()
  expect(fillCombinedCurvatureMaps([{coefficients:[NaN,0,0,0],targetY:20},...guides.slice(1)],width,height,identity,x,y)).toBeNull()
  expect(fillCombinedCurvatureMaps(guides,width,height,Array(9).fill(0),x,y)).toBeNull()
 })
})
it('rejects a map that is safe in the sampled center but collapses at the left margin',()=>{
 const width=200,height=150
 // First guide stays above 0.2*23 inside the sampled range, but is only 3px high at x=0.
 const guides=[{coefficients:[3,80,-120,80],targetY:23},...[50,80,110].map(y=>({coefficients:[y,0,0,0],targetY:y}))]
 const x=new Float32Array(width*height),y=new Float32Array(width*height)
 expect(fillCombinedCurvatureMaps(guides,width,height,identity,x,y)).toBeNull()
})
it('also rejects excessive compression only beyond the sampled right margin',()=>{
 const width=200,height=150
 const guides=[...[20,40,60].map(y=>({coefficients:[y,0,0,0],targetY:y})),{coefficients:[90,0,0,50],targetY:96.25}]
 // At x/W=0.965 the final band scale exceeds 0.2; at x=(W-1)/W it does not.
 const x=new Float32Array(width*height),y=new Float32Array(width*height)
 expect(fillCombinedCurvatureMaps(guides,width,height,identity,x,y)).toBeNull()
})

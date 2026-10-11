import {describe,it,expect} from 'vitest'
import {improveDocumentContrast,validScannerQuad} from './documentScanner.client'
describe('document scanner corners',()=>{
 const quad={a:{x:0.1,y:0.9},b:{x:0.2,y:0.1},c:{x:0.8,y:0.15},d:{x:0.9,y:0.95}}
 it('accepts the four visible corners of a perspective-distorted sheet',()=>expect(validScannerQuad(quad)).toBe(true))
 it('rejects crossed corners, tiny crops and coordinates outside the image',()=>{
  expect(validScannerQuad({...quad,c:quad.d,d:quad.c})).toBe(false)
  expect(validScannerQuad({...quad,b:quad.a})).toBe(false)
  expect(validScannerQuad({...quad,b:{x:-0.1,y:0.1}})).toBe(false)
  expect(validScannerQuad({a:{x:0.1,y:0.11},b:{x:0.1,y:0.1},c:{x:0.11,y:0.1},d:{x:0.11,y:0.11}})).toBe(false)
 })
 it('brightens the paper while preserving a dark character',()=>{
  const data=new Uint8ClampedArray(5*5*4)
  for(let i=0;i<25;i+=1){data.set([180,180,180,255],i*4)}
  data.set([50,50,50,255],12*4)
  const result=improveDocumentContrast({width:5,height:5,data} as ImageData)
  expect(result.data[0]).toBeGreaterThan(180)
  expect(result.data[12*4]).toBeLessThan(50)
  expect(result.data[12*4+3]).toBe(255)
 })
})

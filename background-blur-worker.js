/*
 * Raster StackBlur worker for photo backgrounds; image data stays in this browser.
 * StackBlur's triangular stack-kernel algorithm is based on Mario Klingemann's
 * StackBlur (MIT): Copyright (c) 2010 Mario Klingemann.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files, to deal in the Software
 * without restriction, including without limitation the rights to use, copy,
 * modify, merge, publish, distribute, sublicense, and/or sell copies, and to
 * permit persons to whom the Software is furnished to do so, subject to the
 * following conditions: this copyright notice and permission notice shall be
 * included in all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN IT.
 */
function stackBlurImageData(imageData, width, height, radius) {
  radius = Math.max(1, Math.min(40, Math.round(radius)));
  const pixels = imageData.data;
  const divisor = (radius + 1) * (radius + 1);
  const radiusPlus1 = radius + 1;
  const sumFactor = radiusPlus1 * (radiusPlus1 + 1) / 2;
  const diameter = radius * 2 + 1;
  const stack = Array.from({length: diameter}, () => ({r: 0, g: 0, b: 0, a: 0}));

  // StackBlur uses a triangular stack kernel and a running sum, so work is linear in pixels.
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    const first = [pixels[row], pixels[row + 1], pixels[row + 2], pixels[row + 3]];
    for (let i = 0; i <= radius; i++) Object.assign(stack[i], {r: first[0], g: first[1], b: first[2], a: first[3]});
    let rIn = 0, gIn = 0, bIn = 0, aIn = 0;
    let rOut = radiusPlus1 * first[0], gOut = radiusPlus1 * first[1], bOut = radiusPlus1 * first[2], aOut = radiusPlus1 * first[3];
    let rSum = sumFactor * first[0], gSum = sumFactor * first[1], bSum = sumFactor * first[2], aSum = sumFactor * first[3];
    for (let i = 1; i <= radius; i++) {
      const p = row + Math.min(width - 1, i) * 4;
      const r = pixels[p], g = pixels[p + 1], b = pixels[p + 2], a = pixels[p + 3];
      const weight = radiusPlus1 - i;
      const item = stack[radius + i]; Object.assign(item, {r, g, b, a});
      rSum += r * weight; gSum += g * weight; bSum += b * weight; aSum += a * weight;
      rIn += r; gIn += g; bIn += b; aIn += a;
    }
    let stackIn = 0, stackOut = radiusPlus1;
    for (let x = 0; x < width; x++) {
      const p = row + x * 4;
      pixels[p] = Math.round(rSum / divisor); pixels[p + 1] = Math.round(gSum / divisor);
      pixels[p + 2] = Math.round(bSum / divisor); pixels[p + 3] = Math.round(aSum / divisor);
      rSum -= rOut; gSum -= gOut; bSum -= bOut; aSum -= aOut;
      const leaving = stack[stackIn];
      rOut -= leaving.r; gOut -= leaving.g; bOut -= leaving.b; aOut -= leaving.a;
      const incomingIndex = row + Math.min(width - 1, x + radius + 1) * 4;
      const incoming = stack[stackIn];
      incoming.r = pixels[incomingIndex]; incoming.g = pixels[incomingIndex + 1];
      incoming.b = pixels[incomingIndex + 2]; incoming.a = pixels[incomingIndex + 3];
      rIn += incoming.r; gIn += incoming.g; bIn += incoming.b; aIn += incoming.a;
      rSum += rIn; gSum += gIn; bSum += bIn; aSum += aIn;
      stackIn = (stackIn + 1) % diameter;
      const outgoing = stack[stackOut]; rOut += outgoing.r; gOut += outgoing.g; bOut += outgoing.b; aOut += outgoing.a;
      rIn -= outgoing.r; gIn -= outgoing.g; bIn -= outgoing.b; aIn -= outgoing.a;
      stackOut = (stackOut + 1) % diameter;
    }
  }

  for (let x = 0; x < width; x++) {
    const firstIndex = x * 4;
    const first = [pixels[firstIndex], pixels[firstIndex + 1], pixels[firstIndex + 2], pixels[firstIndex + 3]];
    for (let i = 0; i <= radius; i++) Object.assign(stack[i], {r: first[0], g: first[1], b: first[2], a: first[3]});
    let rIn = 0, gIn = 0, bIn = 0, aIn = 0;
    let rOut = radiusPlus1 * first[0], gOut = radiusPlus1 * first[1], bOut = radiusPlus1 * first[2], aOut = radiusPlus1 * first[3];
    let rSum = sumFactor * first[0], gSum = sumFactor * first[1], bSum = sumFactor * first[2], aSum = sumFactor * first[3];
    for (let i = 1; i <= radius; i++) {
      const p = (Math.min(height - 1, i) * width + x) * 4;
      const r = pixels[p], g = pixels[p + 1], b = pixels[p + 2], a = pixels[p + 3];
      const weight = radiusPlus1 - i;
      const item = stack[radius + i]; Object.assign(item, {r, g, b, a});
      rSum += r * weight; gSum += g * weight; bSum += b * weight; aSum += a * weight;
      rIn += r; gIn += g; bIn += b; aIn += a;
    }
    let stackIn = 0, stackOut = radiusPlus1;
    for (let y = 0; y < height; y++) {
      const p = (y * width + x) * 4;
      pixels[p] = Math.round(rSum / divisor); pixels[p + 1] = Math.round(gSum / divisor);
      pixels[p + 2] = Math.round(bSum / divisor); pixels[p + 3] = Math.round(aSum / divisor);
      rSum -= rOut; gSum -= gOut; bSum -= bOut; aSum -= aOut;
      const leaving = stack[stackIn];
      rOut -= leaving.r; gOut -= leaving.g; bOut -= leaving.b; aOut -= leaving.a;
      const incomingIndex = (Math.min(height - 1, y + radius + 1) * width + x) * 4;
      const incoming = stack[stackIn];
      incoming.r = pixels[incomingIndex]; incoming.g = pixels[incomingIndex + 1];
      incoming.b = pixels[incomingIndex + 2]; incoming.a = pixels[incomingIndex + 3];
      rIn += incoming.r; gIn += incoming.g; bIn += incoming.b; aIn += incoming.a;
      rSum += rIn; gSum += gIn; bSum += bIn; aSum += aIn;
      stackIn = (stackIn + 1) % diameter;
      const outgoing = stack[stackOut]; rOut += outgoing.r; gOut += outgoing.g; bOut += outgoing.b; aOut += outgoing.a;
      rIn -= outgoing.r; gIn -= outgoing.g; bIn -= outgoing.b; aIn -= outgoing.a;
      stackOut = (stackOut + 1) % diameter;
    }
  }
  return imageData;
}

self.addEventListener('message', async event => {
  const {requestId, image, width, height, radius} = event.data || {};
  if (!image || !width || !height) return;
  try {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', {willReadFrequently: true});
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    stackBlurImageData(imageData, width, height, radius);
    context.putImageData(imageData, 0, 0);
    const bitmap = await createImageBitmap(canvas);
    self.postMessage({requestId, bitmap}, [bitmap]);
  } catch (error) {
    self.postMessage({requestId, error: error?.message || 'Could not blur the background'});
  } finally {
    image.close?.();
  }
});

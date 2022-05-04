/*
    LittleJS - The Little JavaScript Game Engine That Can - By Frank Force 2021

    Engine Features
    - Engine and debug system are separate from game code
    - Object oriented with base class engine object
    - Engine handles core update loop
    - Base class object handles update, physics, collision, rendering, etc
    - Engine helper classes and functions like Vector2, Color, and Timer
    - Super fast rendering system for tile sheets
    - Sound effects audio with zzfx and music with zzfxm
    - Input processing system with gamepad and touchscreen support
    - Tile layer rendering and collision system
    - Particle effect system
    - Automatically calls appInit(), appUpdate(), appUpdatePost(), appRender(), appRenderPost()
    - Debug tools and debug rendering system
    - Call engineInit() to start it up!
*/

'use strict';

///////////////////////////////////////////////////////////////////////////////
// engine config

const engineName = 'LittleJS';
const engineVersion = 'v0.74';
const FPS = 60, timeDelta = 1/FPS;
const defaultFont = 'arial'; // font used for text rendering
const maxWidth = 1920, maxHeight = 1200; // up to 1080p and 16:10
const fixedWidth = 0; // native resolution
//const fixedWidth = 1280, fixedHeight = 720; // 720p
//const fixedWidth = 128,  fixedHeight = 128; // PICO-8
//const fixedWidth = 240,  fixedHeight = 136; // TIC-80

// tile sheet settings
//const defaultTilesFilename = 'a.png'; // everything goes in one tile sheet
const defaultTileSize = vec2(16); // default size of tiles in pixels
const tileBleedShrinkFix = .3;    // prevent tile bleeding from neighbors
const pixelated = 1;              // use crisp pixels for pixel art

///////////////////////////////////////////////////////////////////////////////
// core engine

const gravity = -.01;
let mainCanvas=0, mainContext=0, mainCanvasSize=vec2();
let engineObjects=[], engineCollideObjects=[];
let frame=0, time=0, realTime=0, paused=0, frameTimeLastMS=0, frameTimeBufferMS=0, debugFPS=0;
let cameraPos=vec2(), cameraScale=4*max(defaultTileSize.x, defaultTileSize.y);
let tileImageSize, tileImageSizeInverse, shrinkTilesX, shrinkTilesY, drawCount;

const tileImage = new Image(); // the tile image used by everything
function engineInit(appInit, appUpdate, appUpdatePost, appRender, appRenderPost)
{
    // init engine when tiles load
    tileImage.onload = ()=>
    {
        // save tile image info
        tileImageSizeInverse = vec2(1).divide(tileImageSize = vec2(tileImage.width, tileImage.height));
        debug && (tileImage.onload=()=>ASSERT(1)); // tile sheet can not reloaded
        shrinkTilesX = tileBleedShrinkFix/tileImageSize.x;
        shrinkTilesY = tileBleedShrinkFix/tileImageSize.y;

        // setup html
        document.body.appendChild(mainCanvas = document.createElement('canvas'));
        document.body.style = 'margin:0;overflow:hidden;background:#000';
        mainCanvas.style = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);image-rendering:crisp-edges;image-rendering:pixelated';          // pixelated rendering
        mainContext = mainCanvas.getContext('2d');

        debugInit();
        glInit();
        appInit();
        engineUpdate();
    };

    // main update loop
    const engineUpdate = (frameTimeMS=0)=>
    {
        requestAnimationFrame(engineUpdate);
        
        if (!document.hasFocus())
            inputData[0].length = 0; // clear input when lost focus

        // prepare to update time
        const realFrameTimeDeltaMS = frameTimeMS - frameTimeLastMS;
        let frameTimeDeltaMS = realFrameTimeDeltaMS;
        frameTimeLastMS = frameTimeMS;
        realTime = frameTimeMS / 1e3;
        if (debug)
            frameTimeDeltaMS *= keyIsDown(107) ? 5 : keyIsDown(109) ? .2 : 1;
        if (!paused)
            frameTimeBufferMS += frameTimeDeltaMS;

        // update frame
        mousePosWorld = screenToWorld(mousePosScreen);
        updateGamepads();

        // apply time delta smoothing, improves smoothness of framerate in some browsers
        let deltaSmooth = 0;
        if (frameTimeBufferMS < 0 && frameTimeBufferMS > -9)
        {
            // force an update each frame if time is close enough (not just a fast refresh rate)
            deltaSmooth = frameTimeBufferMS;
            frameTimeBufferMS = 0;
            //debug && frameTimeBufferMS < 0 && console.log('time smoothing: ' + -deltaSmooth);
        }
        //debug && frameTimeBufferMS < 0 && console.log('skipped frame! ' + -frameTimeBufferMS);

        // clamp incase of extra long frames (slow framerate)
        frameTimeBufferMS = min(frameTimeBufferMS, 50);
        
        // update the frame
        for (;frameTimeBufferMS >= 0; frameTimeBufferMS -= 1e3 / FPS)
        {
            // main frame update
            appUpdate();
            engineUpdateObjects();
            appUpdatePost();
            debugUpdate();

            // update input
            for(let deviceInputData of inputData)
                deviceInputData.map(k=> k.r = k.p = 0);
            mouseWheel = 0;
        }

        // add the smoothing back in
        frameTimeBufferMS += deltaSmooth;

        if (fixedWidth)
        {
            // clear and fill window if smaller
            mainCanvas.width = fixedWidth;
            mainCanvas.height = fixedHeight;
            
            // fit to window width if smaller
            const fixedAspect = fixedWidth / fixedHeight;
            const aspect = innerWidth / innerHeight;
            mainCanvas.style.width = aspect < fixedAspect ? '100%' : '';
            mainCanvas.style.height = aspect < fixedAspect ? '' : '100%';
        }
        else
        {
            // fill the window
            mainCanvas.width = min(innerWidth, maxWidth);
            mainCanvas.height = min(innerHeight, maxHeight);
        }

        // save canvas size
        mainCanvasSize = vec2(mainCanvas.width, mainCanvas.height);
        mainContext.imageSmoothingEnabled = !pixelated; // disable smoothing for pixel art

        // render sort then render while removing destroyed objects
        glPreRender(mainCanvas.width, mainCanvas.height);
        appRender();
        engineObjects.sort((a,b)=> a.renderOrder - b.renderOrder);
        for(const o of engineObjects)
            o.destroyed || o.render();
        glCopyToContext(mainContext);
        appRenderPost();
        debugRender();

        if (showWatermark)
        {
            // update fps
            debugFPS = lerp(.05, 1e3/(realFrameTimeDeltaMS||1), debugFPS);
            mainContext.textAlign = 'right';
            mainContext.textBaseline = 'top';
            mainContext.font = '1em monospace';
            mainContext.fillStyle = '#000';
            const text = engineName + ' ' + engineVersion + ' / ' 
                + drawCount + ' / ' + engineObjects.length + ' / ' + debugFPS.toFixed(1);
            mainContext.fillText(text, mainCanvas.width-3, 3);
            mainContext.fillStyle = '#fff';
            mainContext.fillText(text, mainCanvas.width-2,2);
            drawCount = 0;
        }

        // copy anything left in the buffer if necessary
        glCopyToContext(mainContext);
    }

    //tileImage.src = 'tiles.png';
    tileImage.src = 
`data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAABACAYAAADS1n9/AAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAyFpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuNi1jMTQyIDc5LjE2MDkyNCwgMjAxNy8wNy8xMy0wMTowNjozOSAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENDIChXaW5kb3dzKSIgeG1wTU06SW5zdGFuY2VJRD0ieG1wLmlpZDo1MEM5MjQ3QUNCN0IxMUVDQkM1RTg5MzVEOTlFRDU2NiIgeG1wTU06RG9jdW1lbnRJRD0ieG1wLmRpZDo1MEM5MjQ3QkNCN0IxMUVDQkM1RTg5MzVEOTlFRDU2NiI+IDx4bXBNTTpEZXJpdmVkRnJvbSBzdFJlZjppbnN0YW5jZUlEPSJ4bXAuaWlkOjUwQzkyNDc4Q0I3QjExRUNCQzVFODkzNUQ5OUVENTY2IiBzdFJlZjpkb2N1bWVudElEPSJ4bXAuZGlkOjUwQzkyNDc5Q0I3QjExRUNCQzVFODkzNUQ5OUVENTY2Ii8+IDwvcmRmOkRlc2NyaXB0aW9uPiA8L3JkZjpSREY+IDwveDp4bXBtZXRhPiA8P3hwYWNrZXQgZW5kPSJyIj8+GT3lNwAAB/tJREFUeNrsXV1sFFUUPjO722WXllJaU7A2+EdRCQmGaCQKKcZEHuirSR/0hUQS4xuPPgAPPvJmTErCCySS8AoPJj6UiEYkVgwQTKuJDYW0VQw/he3+dHacs+yph9s7M3dm7v7Q3g82Mzt7z53b+333nHPPbMFyXRcM1i4svw9cQRmWh6COjh075kquWToH69b+1gZttdMkHvry62nv0A/18XmTBdV0GroXHkB+sQD/9vRCOZUG23H4vM+f+uKzF3XYx5rLOr22jHhX4hb8rhP5R48eBfEVnd/gz63/FRs0PrcuxhUvmUg12a+rv3LeOslVMtkcFIq5fZe/z7396+VcsVLNVdIdOduCHLZh7XXZx4YdtOpVPENE1T0FCfmyiV9WrEtHYQjimFB8HlmiSEmUbtjPFNU+VbH6l5dmKgWlYgGKN3+E9XM3oFKag3t//gJLC/e9z9LSeUlqnwTpOMRi27CQ0BDgEPG2CkMVPVBUjxTH3rJTsFgsgzM9ATu23IPynn2wsVKB92duwaXpMixsfQc683moOpWG2CcSQFMSDg8kNB8BWQG2/E0sEqMiqr2dzsCD+bvwz/XfYOjldXCzY4N3DaD02IXbV36CvNMDr+7cVftZZOstqX3sEBDHrccNBVYdcUxZTLCCRILHoFsIMV6LvW3b4DhleDh3DR7euA13ztnw3cmbMHZ6HK5+swibf8/C0sxtKDklb6V7024V+z/9aq82ey05QFxgti9DxN2IpdDIsgLIl+UHqis7qT1O5VKpAOsqUzDQWYAu78/rz/fBrh0DMJjLwwuZPujp3oR+vnYPL6XTbN9CARBOL37kys6bFFpaZv/EI1Yhk8lDtvctKG/dAtkP78PQgT74YM8b0D9iw1+7SpAaHIBsKlsjsLxY1Wrf8hwA3dEPp2aB3BKdn/z8ktUsEfi5dHlTvfZIYCrTAfaGbdAzeAve3dsJpQUb5qbn4aWtWbi6uB6KXoxHB4bWGW8FOxrtEwmAJ2cRJ3yZ/PcObVnR5pPcuabuFMStW9Q2EexdHrKcjDuPhZyq40D3xi54sHEQfr72B+wc6IGBzXm4PvMYKl2vQXdvL7jO0oowk9S+bUKAah0gaT2hEUOrF3pUyV+xladu0ukUOOk8PCosweTMPJy5MgvXrCHofuVNyGY99119sm7LhY675B2LhUf9Sey1hIAoXqAlNYDoHsCKUGVULV/79TOLC9kplPs9Rw5LHnldHTnoyVuwkH4O+jZtg8wSQKVQgFS+Y64+tr/JeHHhoUdsFbIe8WH2ZadYs851bpjVEjqjbu9k5LdLCJAQZIVc53aJx3pg4ONQoX1754zf/amPMNvQmomiN5YngURw1IdBbQIr4nUtk6lAkKt6L6+POB5I+4QZPIMeKJYHSJqMJfUM58+fdw8ePAgXLlwAfpyamoKhoaEVR/wcjwjZ5yL8+iMcP34cRkdHY4397Nmzy+e7d+9eHhM7Ls8t3pcd3YmJidp7du9YPGzfvt3i8xjGB/KNc0KCS7d6yRA5eOTvRZJ5ew76nNvwc+qPyKZJp8/5eVSgLRdBHMS9dxDBsXYB+/fvh7GxMSWjw4cPw/j4uJYBc3KJJF5q5StXfM+vI9FEMIL6IA/AVzqSFkS8OKZGkdUI1Fd34IKTCoDI91xKYAeTk5PKQlFdAXwFi3V2waXWjlwkZC+6cmoTlTTsy29VJ/EWqgsgKUZGRqwoHiItxBMYHh4Oizk1EeicANHN0zmfbIr9JJKw2C8KCG3IQ5C9H/kUz2UxvxEiaCWkOYCfCC5evKh9AOIKF6/TSpbFfj+CeQjgkIUWGflBBOsWQdvkAK2GLPHjIYHvAnhixycwjGDer+h1Vgti5wDtQH5QAhi05ZOFAS4WccvGxdJqEbQ6B7DbgXw6IilcwUSizO2LOYNsIslTUILIXzxcrGW03AP4rWS+jxezfjFM0CrnYYFEIbq8Rq4+kwNonAwe68kzcDJpVyC6fwolPNungk1QxW+1ZPZacoBGZPtRE0GxIkgD57sCP/KJaGpLIhJ3CaIHCKvsYflW9zawreoAuL9XKQQ1gniceFkCyFc+rWZRLKJ38BMVJ09Wf8D3QSJYbTWApwSA5V2s8KkQrLMU7LdvF1c+vxZU/BELPjIhBAmGRNCsMNE2OUAUQnWTL6vtc5cuK+pwEsWnfTLixVDRTFJMHSBBRZCXfXlbv8phkLhkbcOSwyAkfRLYDjnA8rPkEydOwJEjR5RuQm3pZmgfd7BxbVV/YANfITzxAPRFAsxwg/bMYjaMbUk4+IqD4eFhV+aWdLk7g3BYSELYE0A/4HbRe1n4u3L4EEWVSCQORYTfwCUB4vcRogDzEOzHeICEHgBdOVXbVPf/KBiMzUi6zpqBanIZVSwGCrsAVRLEyUcPQiKg77mpeg8KAUmyWAPNAmjEnp6g+gDGL6dQTVINEgggqnsVcwAiGfshb8LP+RM/zAE8Ul2/MCN6DIM2DAFB8Zza6i4cGeiDbabAeICGZNh+IcBgjewCeD/8nHIEv12AifmrYBeQ9OtWJtt/hncBKgjaBZh9fpMFgHtuct1RSsJRKodR8gaDJguAl4JV/2FEalv/DRq3/kwg8kMhngOYJLFFAqBHskig369EyRI0bKvjcTCGAPNUr3WwzP8XsLZhCkFGAAZGAAZGAAZGAAZGAAZGAAZGAAZGAAZGAAZGAAZGAAZGAAZGAAZGAAarEv8JMAC9NxTUnz2pqQAAAABJRU5ErkJggg==`;
}

function engineUpdateObjects()
{
    // recursive object update
    const updateObject = (o)=>
    {
        if (!o.destroyed)
        {
            o.update();
            for(const child of o.children)
                updateObject(child);
        }
    }
    for(const o of engineObjects)
        o.parent || updateObject(o);
    engineObjects = engineObjects.filter(o=>!o.destroyed);
    engineCollideObjects = engineCollideObjects.filter(o=>!o.destroyed);
    time = ++frame / FPS;
}

function forEachObject(pos, size=0, callbackFunction=(o)=>1, collideObjectsOnly=1)
{
    const objectList = collideObjectsOnly ? engineCollideObjects : engineObjects;
    if (!size)
    {
        // no overlap test
        for (const o of objectList)
            callbackFunction(o);
    }
    else if (size.x != undefined)
    {
        // aabb test
        for (const o of objectList)
            isOverlapping(pos, size, o.pos, o.size) && callbackFunction(o);
    }
    else
    {
        // circle test
        const sizeSquared = size**2;
        for (const o of objectList)
            pos.distanceSquared(o.pos) < sizeSquared && callbackFunction(o);
    }
}
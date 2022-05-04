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
`data:image/png;base64,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`;
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
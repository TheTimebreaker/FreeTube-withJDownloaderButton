This is a fork of the master branch of [FreeTube](https://github.com/FreeTubeApp/FreeTube) .

This forks only feature is the addition of a "Download with JDownloader" button, that sends a video URL to your running JDownloader instance for downloading.
I probably won't be merging every upstream change from the master branch immediately (only when I notice something not working as intended), so it is very possible for this fork to always be a bit out-of-date.

## How to install
Either compile yourself (see below) or download the already compiled executables from the releases.

## How to compile
The most up-to-date information on this can be found in [FreeTube's documentation](https://docs.freetubeapp.io/development/building-from-source).
But in general:
* Download this repository. Either do this from the command line using `git` or by clicking "Code", then "Download ZIP" here on this repos' page, then unpack the folder.
* Open the command line.
* Use the `cd` command to open the directory you just cloned / downloaded.
* Run `yarn install` . This will install all dependencies. (You may need to install [yarn](https://yarnpkg.com))
* Run `yarn run build` .

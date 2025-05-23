import store from '../../store/index'
import {
  calculatePublishedDate,
  getRelativeTimeFromDate,
  stripHTML,
} from '../utils'
import { isNullOrEmpty } from '../strings'
import autolinker from 'autolinker'
import { FormatUtils, Misc, Player } from 'youtubei.js'

/** @typedef {{url: string, width: number, height: number}} InvidiousImageObject */
/** @typedef {{quality: string, url: string, width: number, height: number}} InvidiousThumbnailObject */
/** @typedef {{type: 'video', title: string, videoId: string, author: string, authorId: string, authorUrl: string, authorVerified: boolean, videoThumbnails: InvidiousThumbnailObject[], description: string?, descriptionHtml: string?, viewCount: number, viewCountText: string, lengthSeconds: number, published: number, publishedText: string, premiereTimestamp: number, liveNow: boolean, premium: boolean, isUpcoming: boolean, hasCaptions: boolean, is3d: boolean, is4k: boolean, is8k: boolean, isNew: boolean, isVr180: boolean, isVr360: boolean}} InvidiousVideoType */
/** @typedef {{type: 'channel', author: string, authorId: string, authorUrl: string, authorVerified: boolean, authorThumbnails: InvidiousThumbnailObject[], autoGenerated: boolean, subCount: number, videoCount: number, description: string, descriptionHtml: string}} InvidiousChannelObject */
/** @typedef {{type: 'playlist', title: string, playlistId: string, playlistThumbnail: string, author: string, authorId: string, authorUrl: string, authorVerified: boolean, videoCount: number, videos: {title: string, videoId: string, lengthSeconds: number, videoThumbnails: InvidiousThumbnailObject[]}[]}} InvidiousPlaylistObject */
/** @typedef {{type: 'hashtag', title: string, url: string, channelCount: number, videoCount: number}} InvidiousHashtagObject */

/**
 * @returns {string}
 */
function getCurrentInstanceUrl() {
  return store.getters.getCurrentInvidiousInstanceUrl
}

/**
 * @param {string} uri
 */
export function getProxyUrl(uri) {
  const currentInstance = getCurrentInstanceUrl()

  const url = new URL(uri)
  const { origin } = url
  if (!url.searchParams.has('host') && origin !== currentInstance) {
    // invidious requires host param to be filled with the origin of the stream
    url.searchParams.append('host', origin.replace('https://', ''))
  }
  return url.toString().replace(origin, currentInstance)
}

/**
 * @param {string | URL} url
 */
export function invidiousFetch(url) {
  const authorization = store.getters.getCurrentInvidiousInstanceAuthorization

  if (authorization) {
    return fetch(url, {
      headers: {
        Authorization: authorization
      }
    })
  } else {
    return fetch(url)
  }
}

function invidiousAPICall({ resource, id = '', params = {}, doLogError = true, subResource = '' }) {
  return new Promise((resolve, reject) => {
    const requestUrl = getCurrentInstanceUrl() + '/api/v1/' + resource + '/' + id + (!isNullOrEmpty(subResource) ? `/${subResource}` : '') + '?' + new URLSearchParams(params).toString()
    invidiousFetch(requestUrl)
      .then((response) => response.json())
      .then((json) => {
        if (json.error !== undefined) {
          // community is empty, no need to display error.
          // This code can be removed when: https://github.com/iv-org/invidious/issues/3814 is reolved
          if (json.error === 'This channel hasn\'t posted yet') {
            resolve({ comments: [] })
          } else {
            throw new Error(json.error)
          }
        }
        resolve(json)
      })
      .catch((error) => {
        if (doLogError) {
          console.error('Invidious API error', requestUrl, error)
        }
        reject(error)
      })
  })
}

async function resolveUrl(url) {
  return await invidiousAPICall({
    resource: 'resolveurl',
    params: {
      url
    },
    doLogError: false
  })
}

/**
 * Gets the channel ID for a channel URL
 * used to get the ID for channel usernames and handles
 * @param {string} url
 * @returns {Promise<string?>} channel ID
 */
export async function invidiousGetChannelId(url) {
  try {
    const response = await resolveUrl(url)

    if (response.pageType === 'WEB_PAGE_TYPE_CHANNEL') {
      return response.ucid
    } else {
      return null
    }
  } catch {
    return null
  }
}

/**
 * @param {string} channelId
 * @returns {Promise<{
 *  author: string,
 *  authorId: string,
 *  authorUrl: string,
 *  authorVerified: boolean,
 *  authorBanners: InvidiousImageObject[],
 *  authorThumbnails: InvidiousImageObject[],
 *  subCount: number,
 *  totalViews: number,
 *  joined: number,
 *  autoGenerated: boolean,
 *  isFamilyFriendly: boolean,
 *  description: string,
 *  descriptionHtml: string,
 *  allowedRegions: string[],
 *  tabs: ('home' | 'videos' | 'shorts' | 'streams' | 'podcasts' | 'releases' | 'playlists' | 'community')[],
 *  latestVideos: InvidiousVideoType[],
 *  relatedChannels: InvidiousChannelObject[]
 * }>}
 */
export async function invidiousGetChannelInfo(channelId) {
  return await invidiousAPICall({
    resource: 'channels',
    id: channelId,
  })
}

/**
 * @param {string} tab
 * @param {string} channelId
 * @param {string | undefined | null} continuation
 * @param {string | undefined} sortBy
 */
async function getInvidiousChannelTab(tab, channelId, continuation, sortBy) {
  const params = {}

  if (continuation) {
    params.continuation = continuation
  }

  if (sortBy) {
    params.sort_by = sortBy
  }

  return await invidiousAPICall({
    resource: 'channels',
    id: channelId,
    subResource: tab,
    params
  })
}

/**
 * @param {string} channelId
 * @param {string | undefined} sortBy
 * @param {string | undefined | null} continuation
 */
export async function getInvidiousChannelVideos(channelId, sortBy, continuation) {
  /** @type {{continuation: string?, videos: InvidiousVideoType[]}}  */
  const response = await getInvidiousChannelTab('videos', channelId, continuation, sortBy)

  setMultiplePublishedTimestamps(response.videos)

  return response
}

/**
 * @param {string} channelId
 * @param {string | undefined} sortBy
 * @param {string | undefined | null} continuation
 */
export async function getInvidiousChannelShorts(channelId, sortBy, continuation) {
  /** @type {{continuation: string?, videos: InvidiousVideoType[]}}  */
  const response = await getInvidiousChannelTab('shorts', channelId, continuation, sortBy)

  // workaround for Invidious sending incorrect information
  // https://github.com/iv-org/invidious/issues/3801
  response.videos.forEach(video => {
    video.isUpcoming = false
    delete video.published
    delete video.premiereTimestamp
  })

  return response
}

/**
 * @param {string} channelId
 * @param {string | undefined} sortBy
 * @param {string | undefined | null} continuation
 */
export async function getInvidiousChannelLive(channelId, sortBy, continuation) {
  /** @type {{continuation: string?, videos: InvidiousVideoType[]}}  */
  const response = await getInvidiousChannelTab('streams', channelId, continuation, sortBy)

  setMultiplePublishedTimestamps(response.videos)

  return response
}

/**
 * @param {string} channelId
 * @param {string | undefined} sortBy
 * @param {string | undefined | null} continuation
 */
export async function getInvidiousChannelPlaylists(channelId, sortBy, continuation) {
  /** @type {{continuation: string?, playlists: InvidiousPlaylistObject[]}} */
  return await getInvidiousChannelTab('playlists', channelId, continuation, sortBy)
}

/**
 * @param {string} channelId
 * @param {string | undefined | null} continuation
 */
export async function getInvidiousChannelReleases(channelId, continuation) {
  /** @type {{continuation: string?, playlists: InvidiousPlaylistObject[]}} */
  return await getInvidiousChannelTab('releases', channelId, continuation)
}

/**
 * @param {string} channelId
 * @param {string | undefined | null} continuation
 */
export async function getInvidiousChannelPodcasts(channelId, continuation) {
  /** @type {{continuation: string?, playlists: InvidiousPlaylistObject[]}} */
  return await getInvidiousChannelTab('podcasts', channelId, continuation)
}

/**
 * @param {string} channelId
 * @param {string} query
 * @param {number} page
 */
export async function searchInvidiousChannel(channelId, query, page) {
  /** @type {(InvidiousVideoType | InvidiousPlaylistObject)[]} */
  const response = await invidiousAPICall({
    resource: 'channels',
    id: channelId,
    subResource: 'search',
    params: {
      q: query,
      page
    }
  })

  response.forEach((item) => {
    if (item.type === 'video') {
      setPublishedTimestamp(item)
    }
  })

  return response
}

/**
 * @param {string} playlistId
 * @returns {{
 *  title: string,
 *  playlistId: string,
 *  author: string,
 *  authorId: string,
 *  authorThumbnails: InvidiousImageObject[],
 *  description: string,
 *  descriptionHtml: string,
 *  videoCount: number,
 *  viewCount: number,
 *  updated: number,
 *  videos: {
 *    title: string,
 *    videoId: string,
 *    author: string,
 *    authorId: string,
 *    authorUrl: string,
 *    videoThumbnails: InvidiousThumbnailObject[],
 *    index: number,
 *    lengthSeconds: number
 *  }[]
 * }}
 */
export async function invidiousGetPlaylistInfo(playlistId) {
  const playlist = await invidiousAPICall({
    resource: 'playlists',
    id: playlistId,
  })

  setMultiplePublishedTimestamps(playlist.videos)

  return playlist
}

/**
 * @param {string} videoId
 * @returns {Promise<{
 *  error: string,
 *  type: 'video' | 'published',
 *  title: string,
 *  videoId: string,
 *  videoThumbnails: InvidiousThumbnailObject[],
 *  storyboards: {
 *    url: string,
 *    templateUrl: string,
 *    width: number,
 *    height: number,
 *    count: number,
 *    interval: number,
 *    storyboardWidth: number,
 *    storyboardHeight: number,
 *    storyboardCount: number
 *  }[],
 *  description: string,
 *  descriptionHtml: string,
 *  published: number,
 *  publishedText: string,
 *  keywords: string[],
 *  viewCount: number,
 *  likeCount: number,
 *  dislikeCount: number,
 *  paid: boolean,
 *  premium: boolean,
 *  isFamilyFriendly: boolean,
 *  allowedRegions: string[],
 *  genre: string,
 *  genreUrl: string,
 *  author: string,
 *  authorId: string
 *  authorUrl: string,
 *  authorThumbnails: InvidiousImageObject[],
 *  subCountText: string,
 *  lengthSeconds: number,
 *  allowRatings: boolean,
 *  rating: number,
 *  isListed: boolean,
 *  liveNow: boolean,
 *  isPostLiveDvr: boolean,
 *  isUpcoming: boolean,
 *  dashUrl: string,
 *  premiereTimestamp: number?,
 *  hlsUrl: string?,
 *  adaptiveFormats: {
 *    index: string,
 *    bitrate: string,
 *    init: string,
 *    url: string,
 *    itag: string,
 *    type; string,
 *    clen: string,
 *    lmt: string,
 *    projectionType: string,
 *    container: string,
 *    encoding: string,
 *    qualityLabel: string?,
 *    fps: number?,
 *    size: string?,
 *    resolution: string?,
 *    targetDurationSec: int?,
 *    maxDvrDurationSec: int?,
 *    audioQuality: string?,
 *    audioSampleRate: string?,
 *    audioChannels: string?,
 *    colorInfo: string?,
 *    captionTrack: string?
 *  }[],
 *  formatStreams: {
 *    url: string,
 *    itag: string,
 *    type: string,
 *    quality: string,
 *    bitrate: string?,
 *    fps: int?,
 *    container: string,
 *    encoding: string,
 *    qualityLabel: string,
 *    resolution: string,
 *    size: string
 *  }[],
 *  captions: {
 *    label: string,
 *    language_code: string,
 *    url: string
 *  }[],
 *  musicTracks: {
 *    song: string,
 *    artist: string,
 *    album: string,
 *    license: string
 *  }[]?,
 *  recommendedVideos: InvidiousVideoType[]
 * }>}
 */
export async function invidiousGetVideoInformation(videoId) {
  return await invidiousAPICall({
    resource: 'videos',
    id: videoId,
  })
}

/** @typedef {{commentCount: number, videoId: string, continuation: string?, comments: {author: string, authorThumbnails: InvidiousImageObject[], authorId: string, authorUrl: string, isEdited: boolean, isPinned: boolean, content: string, contentHtml: string, published: number, publishedText: string, likeCount: number, commentId: string, authorIsChannelOwner: boolean, creatorHeart: { creatorThumbnail: string, creatorName: string}?, isSponsor: boolean, sponsorIconUrl: string, replies: {replyCount: number, continuation: string}}[]}} InvidiousCommentResponse */

export async function invidiousGetComments({ id, nextPageToken = '', sortNewest = true }) {
  const payload = {
    resource: 'comments',
    id: id,
    params: {
      continuation: nextPageToken ?? '',
      sort_by: sortNewest ? 'new' : 'top'
    }
  }

  /** @type {InvidiousCommentResponse} */
  const response = await invidiousAPICall(payload)

  const commentData = parseInvidiousCommentData(response)

  return { response, commentData }
}

export async function invidiousGetCommentReplies({ id, replyToken }) {
  const payload = {
    resource: 'comments',
    id: id,
    params: {
      continuation: replyToken
    }
  }

  const response = await invidiousAPICall(payload)
  return { commentData: parseInvidiousCommentData(response), continuation: response.continuation ?? null }
}

/**
 * @param {string} query
 * @returns {Promise<{ query: string, suggestions: string[]}>}
 */
export async function getInvidiousSearchSuggestions(query) {
  return await invidiousAPICall({
    resource: 'search/suggestions',
    id: '',
    params: {
      q: query
    }
  })
}

/**
 * @returns {Promise<{
 *  type: 'shortVideo',
 *  title: string,
 *  videoId: string,
 *  videoThumbnails: InvidiousThumbnailObject[],
 *  lengthSeconds: number,
 *  viewCount: number,
 *  author: string,
 *  authorId: string,
 *  authorUrl: string,
 *  published: number,
 *  publishedText: string
 * }[]>}
 */
export async function getInvidiousPopularFeed() {
  const response = await invidiousAPICall({
    resource: 'popular',
    id: '',
    params: {}
  })

  const items = response.filter((item) => {
    return item.type === 'video' || item.type === 'shortVideo' || item.type === 'channel' || item.type === 'playlist'
  })

  items.forEach((item) => {
    if (item.type === 'video' || item.type === 'shortVideo') {
      setPublishedTimestamp(item)
    }
  })

  return items
}

/**
 * @param {'default' | 'music' | 'gaming' | 'movies'} tab
 * @param {string} region
 * @returns {Promise<InvidiousVideoType[] | null>}
 */
export async function getInvidiousTrending(tab, region) {
  const params = {
    resource: 'trending',
    id: '',
    params: {
      region
    }
  }

  if (tab !== 'default') {
    params.params.type = tab.charAt(0).toUpperCase() + tab.substring(1)
  }

  const response = await invidiousAPICall(params)

  if (!response) {
    return null
  }

  const items = response.filter((item) => {
    return item.type === 'video' || item.type === 'channel' || item.type === 'playlist'
  })

  items.forEach((item) => {
    if (item.type === 'video') {
      setPublishedTimestamp(item)
    }
  })

  return items
}

/**
 * @param {string} query
 * @param {number} page
 * @param {any} searchSettings
 */
export async function getInvidiousSearchResults(query, page, searchSettings) {
  /** @type {Promise<(InvidiousChannelObject | InvidiousPlaylistObject | InvidiousVideoType | InvidiousHashtagObject)[] | null>} */
  let results = await invidiousAPICall({
    resource: 'search',
    id: '',
    params: {
      q: query,
      page,
      sort_by: searchSettings.sortBy,
      date: searchSettings.time,
      duration: searchSettings.duration,
      type: searchSettings.type,
      features: searchSettings.features.join(',')
    }
  })

  if (!results) {
    return null
  }

  results = results.filter((item) => {
    return item.type === 'video' || item.type === 'channel' || item.type === 'playlist' || item.type === 'hashtag'
  })

  results.forEach((item) => {
    if (item.type === 'video') {
      setPublishedTimestamp(item)
    }
  })

  return results
}

/**
 * @param {string} url
 * @param {string?} currentInstance
 * @returns {string?}
 */
export function youtubeImageUrlToInvidious(url, currentInstance = null) {
  if (url == null) {
    return null
  }

  if (currentInstance === null) {
    currentInstance = getCurrentInstanceUrl()
  }
  // Can be prefixed with `https://` or `//` (protocol relative)
  if (url.startsWith('//')) {
    url = 'https:' + url
  }
  const newUrl = `${currentInstance}/ggpht`
  return url.replace('https://yt3.ggpht.com', newUrl)
    .replace('https://yt3.googleusercontent.com', newUrl)
    .replace(/https:\/\/i\d*\.ytimg\.com/, newUrl)
}

/**
 * @param {string} url
 * @param {string?} currentInstance
 * @returns {string}
 */
export function invidiousImageUrlToInvidious(url, currentInstance = null) {
  return url.replaceAll('/ggpht/', `${currentInstance}/ggpht/`)
}

/**
 * @param {InvidiousCommentResponse} response
 */
function parseInvidiousCommentData(response) {
  return response.comments.map((comment) => {
    return {
      id: comment.commentId,
      showReplies: false,
      authorLink: comment.authorId,
      authorThumb: youtubeImageUrlToInvidious(comment.authorThumbnails.at(-1).url),
      author: comment.author,
      likes: comment.likeCount,
      text: autolinker.link(stripHTML(invidiousImageUrlToInvidious(comment.contentHtml, getCurrentInstanceUrl()))),
      dataType: 'invidious',
      isOwner: comment.authorIsChannelOwner,
      isPinned: comment.isPinned,
      numReplies: comment.replies?.replyCount ?? 0,
      hasReplyToken: !!comment.replies?.continuation,
      replyToken: comment.replies?.continuation ?? '',
      isHearted: comment.creatorHeart !== undefined,
      isMember: comment.isSponsor,
      memberIconUrl: youtubeImageUrlToInvidious(comment.sponsorIconUrl),
      replies: [],
      time: getRelativeTimeFromDate(comment.published * 1000, false)
    }
  })
}

export async function invidiousGetCommunityPosts(channelId, continuation = null) {
  const payload = {
    resource: 'channels',
    id: channelId,
    subResource: 'community',
    params: {}
  }

  if (continuation) {
    payload.params.continuation = continuation
  }

  const response = await invidiousAPICall(payload)
  response.comments = response.comments.map(communityPost => parseInvidiousCommunityData(communityPost))
  return { posts: response.comments, continuation: response.continuation ?? null }
}

export async function getInvidiousCommunityPost(postId, authorId = null) {
  const payload = {
    resource: 'post',
    id: postId,
  }

  if (authorId == null) {
    authorId = await invidiousGetChannelId('https://www.youtube.com/post/' + postId)
  }

  payload.params = {
    ucid: authorId
  }

  const response = await invidiousAPICall(payload)

  const post = parseInvidiousCommunityData(response.comments[0])
  post.authorId = authorId
  post.commentCount = null

  return post
}

export async function getInvidiousCommunityPostComments({ postId, authorId }) {
  const payload = {
    resource: 'post',
    id: postId,
    subResource: 'comments',
    params: {
      ucid: authorId
    }
  }

  const response = await invidiousAPICall(payload)
  const commentData = parseInvidiousCommentData(response)

  return { response, commentData }
}

export async function getInvidiousCommunityPostCommentReplies({ postId, replyToken, authorId }) {
  const payload = {
    resource: 'post',
    id: postId,
    subResource: 'comments',
    params: {
      ucid: authorId,
      continuation: replyToken
    }
  }

  const response = await invidiousAPICall(payload)
  return { commentData: parseInvidiousCommentData(response), continuation: response.continuation ?? null }
}

function parseInvidiousCommunityData(data) {
  return {
    // use #/ to support channel YT links.
    // ex post: https://www.youtube.com/post/UgkxMpGt1SVlHwA1afwqDr2DZLn-hmJJQqKo
    postText: data.contentHtml.replaceAll('href="/', 'href="#/'),
    postId: data.commentId,
    authorThumbnails: data.authorThumbnails.map(thumbnail => {
      thumbnail.url = youtubeImageUrlToInvidious(thumbnail.url)
      return thumbnail
    }),
    publishedTime: calculatePublishedDate(data.publishedText),
    voteCount: data.likeCount,
    postContent: parseInvidiousCommunityAttachments(data.attachment),
    commentCount: data?.replyCount ?? 0, // https://github.com/iv-org/invidious/pull/3635/
    authorId: data.authorId,
    author: data.author,
    type: 'community'
  }
}

function parseInvidiousCommunityAttachments(data) {
  if (!data) {
    return null
  }

  // I've only seen this appear when a video was made private.
  // This is not currently supported on local api.
  if (data.error) {
    return {
      type: 'error',
      message: data.error
    }
  }

  if (data.type === 'image') {
    return {
      type: data.type,
      content: data.imageThumbnails.map(thumbnail => {
        thumbnail.url = youtubeImageUrlToInvidious(thumbnail.url)
        return thumbnail
      })
    }
  }

  if (data.type === 'video') {
    data.videoThumbnails = data.videoThumbnails?.map(thumbnail => {
      thumbnail.url = youtubeImageUrlToInvidious(thumbnail.url)
      return thumbnail
    })
    return {
      type: data.type,
      content: data
    }
  }

  if (data.type === 'multiImage') {
    const content = data.images.map(imageThumbnails => {
      return imageThumbnails.map(thumbnail => {
        thumbnail.url = youtubeImageUrlToInvidious(thumbnail.url)
        return thumbnail
      })
    })
    return {
      type: 'multiImage',
      content: content
    }
  }

  // https://github.com/iv-org/invidious/pull/3635/files
  if (data.type === 'poll') {
    return {
      type: 'poll',
      totalVotes: data.totalVotes ?? 0,
      content: data.choices.map(choice => {
        return {
          text: choice.text,
          image: choice.image?.map(thumbnail => {
            thumbnail.url = youtubeImageUrlToInvidious(thumbnail.url)
            return thumbnail
          })
        }
      })
    }
  }

  if (data.type === 'quiz') {
    return {
      type: 'quiz',
      totalVotes: data.totalVotes ?? 0,
      content: data.choices.map(choice => {
        return {
          text: choice.text,
          isCorrect: choice.isCorrect,
          image: choice.image?.map(thumbnail => {
            thumbnail.url = youtubeImageUrlToInvidious(thumbnail.url)
            return thumbnail
          })
        }
      })
    }
  }

  if (data.type === 'playlist') {
    return {
      type: data.type,
      content: data
    }
  }

  console.error(`Unknown Invidious community post type: ${data.type}`)
  console.error(data)
}

/**
 * @param {string} hashtag
 * @param {number} page
 */
export async function getHashtagInvidious(hashtag, page = 1) {
  /** @type {{results: InvidiousVideoType[]}} */
  const response = await invidiousAPICall({
    resource: 'hashtag',
    id: hashtag,
    params: {
      page
    }
  })

  setMultiplePublishedTimestamps(response.results)

  return response.results
}

/**
 * Generates a DASH manifest locally from Invidious' adaptive formats and manifest,
 * doing so allows us to support multiple audio tracks, which Invidious doesn't support yet
 * @param {import('youtubei.js').Misc.Format[]} formats
 */
export async function generateInvidiousDashManifestLocally(formats) {
  // create a dummy player, as deciphering requires making requests to YouTube,
  // which we want to avoid when Invidious is selected as the backend
  const player = new Player()
  player.decipher = (url) => url

  let urlTransformer

  if (store.getters.getProxyVideos) {
    /**
     * @param {URL} url
     */
    urlTransformer = (url) => {
      return new URL(getProxyUrl(url.toString()))
    }
  }

  return await FormatUtils.toDash({
    adaptive_formats: formats
  }, false, urlTransformer, undefined, undefined, player)
}

export function convertInvidiousToLocalFormat(format) {
  const [initStart, initEnd] = format.init.split('-')
  const [indexStart, indexEnd] = format.index.split('-')

  const url = new URL(format.url)

  const duration = parseInt(parseFloat(url.searchParams.get('dur')) * 1000)

  // only converts the properties that are needed to generate a DASH manifest with YouTube.js
  // audioQuality and qualityLabel don't go inside the DASH manifest, but are used by YouTube.js
  // to determine whether a format is an audio or video stream respectively.

  const localFormat = new Misc.Format({
    itag: format.itag,
    mimeType: format.type,
    bitrate: format.bitrate,
    width: format.width,
    height: format.height,
    initRange: {
      start: initStart,
      end: initEnd
    },
    indexRange: {
      start: indexStart,
      end: indexEnd
    },
    // lastModified: format.lmt,
    // contentLength: format.clen,
    url: format.url,
    approxDurationMs: duration,
    ...(format.type.startsWith('audio/')
      ? {
          audioQuality: format.audioQuality,
          audioSampleRate: format.audioSampleRate,
          audioChannels: format.audioChannels
        }
      : {
          fps: format.fps,
          qualityLabel: format.qualityLabel,
          ...(format.colorInfo ? { colorInfo: format.colorInfo } : {})
        })
  })

  if (localFormat.has_audio && url.searchParams.has('xtags')) {
    const xtags = url.searchParams.get('xtags').split(':')

    localFormat.language = xtags.find((tag) => tag.startsWith('lang='))?.split('=')[1] || null
    localFormat.is_drc = xtags.includes('drc=1')

    const audioContent = xtags.find((tag) => tag.startsWith('acont='))?.split('=')[1]
    localFormat.is_dubbed = audioContent === 'dubbed'
    localFormat.is_descriptive = audioContent === 'descriptive'
    localFormat.is_secondary = audioContent === 'secondary'
    localFormat.is_auto_dubbed = audioContent === 'dubbed-auto'
    localFormat.is_original = audioContent === 'original' ||
      (
        !localFormat.is_dubbed &&
        !localFormat.is_descriptive &&
        !localFormat.is_secondary &&
        !localFormat.is_auto_dubbed &&
        !localFormat.is_drc
      )
  }

  return localFormat
}

/**
 * @param {any} format
 */
export function mapInvidiousLegacyFormat(format) {
  const [stringWidth, stringHeight] = format.size.split('x')

  return {
    itag: format.itag,
    qualityLabel: format.qualityLabel,
    fps: format.fps,
    bitrate: parseInt(format.bitrate),
    mimeType: format.type,
    height: parseInt(stringHeight),
    width: parseInt(stringWidth),
    url: format.url
  }
}

/**
 * @param {{
 *  liveNow: boolean,
 *  isUpcoming: boolean,
 *  premiereTimestamp: number,
 *  published: number
 * }[]} videos
 */
function setMultiplePublishedTimestamps(videos) {
  videos.forEach(setPublishedTimestamp)
}

/**
 * @param {{
 *  liveNow: boolean,
 *  isUpcoming: boolean,
 *  premiereTimestamp: number,
 *  published: number
 * }} video
 */
function setPublishedTimestamp(video) {
  if (video.liveNow) {
    video.published = Date.now()
  } else if (video.isUpcoming) {
    video.published = video.premiereTimestamp * 1000
  } else if (typeof video.published === 'number') {
    video.published *= 1000
  }
}

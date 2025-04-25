import { defineComponent } from 'vue'
import FtIconButton from '../ft-icon-button/ft-icon-button.vue'

export default defineComponent({
  name: 'FtJdownloaderButton',
  components: {
    'ft-icon-button': FtIconButton,
  },
  props: {
    shareTargetType: {
      /**
       * Allows to render the dropdown conditionally
       * 'Channel' will exclude embed links
       * 'Video' (default) keeps the original behaviour */
      type: String,
      default: 'Video'
    },
    id: {
      type: String,
      required: true
    },
    playlistId: {
      type: String,
      default: ''
    }
  },
  data: function () {
    return {
      hasBeenSent: false
    }
  },

  computed: {
    hasBeenSentFunc: function () {
      return this.hasBeenSent
    },
    isChannel: function() {
      return this.shareTargetType === 'Channel'
    },

    isPlaylist: function () {
      return this.shareTargetType === 'Playlist'
    },

    isVideo: function() {
      return this.shareTargetType === 'Video'
    },

    shareTitle: function() {
      return this.$t('Share.Send to JDownloader')
    },

    selectedUserPlaylist: function () {
      if (this.playlistId == null || this.playlistId === '') { return null }

      return this.$store.getters.getPlaylist(this.playlistId)
    },

    playlistSharable() {
      // `playlistId` can be undefined
      // User playlist ID should not be shared
      return this.playlistId && this.playlistId.length !== 0 && this.selectedUserPlaylist == null
    },

    youtubeChannelUrl() {
      return `https://www.youtube.com/channel/${this.id}`
    },

    youtubePlaylistUrl() {
      return `https://youtube.com/playlist?list=${this.id}`
    },

    youtubeShareURL() {
      if (this.isChannel) {
        return this.youtubeChannelUrl
      }
      if (this.isPlaylist) {
        return this.youtubePlaylistUrl
      }
      const videoUrl = `https://youtu.be/${this.id}`
      if (this.playlistSharable) {
        // `index` seems can be ignored
        return `${videoUrl}?list=${this.playlistId}`
      }
      return videoUrl
    }
  },
  methods: {
    sendToJdownloader() {
      const jdurl = `http://127.0.0.1:9666/flash/add?urls=${this.youtubeShareURL}&source=freetube`
      fetch(jdurl, {
        method: 'POST',
      })
        .then(response => {
          response.status === 200 ? (() => {})() : (() => { throw new Error(`Status code for JDownloader not 200: ${response.status}`) })()
          return response.text()
        })
        .then(text => {
          if (!(text.trim() === 'success')) {
            throw new Error(`Status for JDownlaoder responded as ${text}`)
          }
          this.hasBeenSent = true
        })
        .catch(error => {
          window.alert(error)
        })
    },
  }
})

<template>
  <ft-icon-button
    ref="iconButton"
    :title="shareTitle"
    theme="secondary"
    :icon="hasBeenSentFunc ? ['fas', 'check'] : ['fas', 'arrow-right']"
    :dropdown-modal-on-mobile="false"
    :force-dropdown="false"
    @click="sendToJdownloader"
  />
</template>

<script src="./ft-jdownloader-button.js" />
<style scoped lang="scss" src="./ft-jdownloader-button.scss" />

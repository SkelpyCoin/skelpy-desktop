;(function () {
  'use strict'

  /**
   * NOTE This component uses the entire AccountController yet: it's the first
   * step to refactor the `index.html`
   */

  angular
    .module('skelpyclient.components')
    .component('networkBox', {
      templateUrl: 'src/components/dashboard/network-box.html',
      bindings: {
        accountCtrl: '='
      },
      controller: NetworkController
    })

  function NetworkController ($scope) {
    this.$onInit = () => {
      this.ul = this.accountCtrl
    }
  }
})()

;(function () {
  'use strict'

  angular.module('skelpyclient.filters', [])
  angular.module('skelpyclient.services', ['ngMaterial'])
  angular.module('skelpyclient.directives', [])
  angular.module('skelpyclient.accounts', ['ngMaterial', 'skelpyclient.services', 'skelpyclient.filters', 'skelpyclient.addons'])
  angular.module('skelpyclient.components', ['gettext', 'ngMaterial', 'skelpyclient.services', 'skelpyclient.accounts'])
  angular.module('skelpyclient.addons', [])
  angular.module('skelpyclient.constants', [])
})()

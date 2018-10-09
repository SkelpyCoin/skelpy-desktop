;(function () {
  'use strict'

  angular.module('skelpyclient.services')
    .service('networkService', ['$q', '$http', '$timeout', 'storageService', 'timeService', 'toastService', NetworkService])

  /**
   * NetworkService
   * @constructor
   */
  function NetworkService ($q, $http, $timeout, storageService, timeService, toastService) {
    var network = switchNetwork(storageService.getContext())

    if (!network) {
      network = switchNetwork()
    }
    var skelpy = require('../node_modules/skelpyjs')
    skelpy.crypto.setNetworkVersion(network.version || 25)

    var clientVersion = require('../../package.json').version

    var peer = {
      ip: network.peerseed,
      network: storageService.getContext(),
      isConnected: false,
      height: 0,
      lastConnection: null,
      price: storageService.getGlobal('peerCurrencies') || { btc: '0.0' }
    }

    var connection = $q.defer()

    connection.notify(peer)

    function setNetwork (name, newnetwork) {
      var n = storageService.getGlobal('networks')
      n[name] = newnetwork
      storageService.setGlobal('networks', n)
    }

    function removeNetwork (name) {
      var n = storageService.getGlobal('networks')
      delete n[name]
      storageService.setGlobal('networks', n)
    }

    function createNetwork (data) {
      var n = storageService.getGlobal('networks')
      var newnetwork = data
      var deferred = $q.defer()
      if (n[data.name]) {
        deferred.reject("Network name '" + data.name + "' already taken, please choose another one")
      } else {
        $http({
          url: data.peerseed + '/api/loader/autoconfigure',
          method: 'GET',
          timeout: 5000
        }).then(
          function (resp) {
            newnetwork = resp.data.network
            newnetwork.forcepeer = data.forcepeer
            newnetwork.peerseed = data.peerseed
            newnetwork.slip44 = 1 // default to testnet slip44
            newnetwork.cmcTicker = data.cmcTicker
            n[data.name] = newnetwork
            storageService.setGlobal('networks', n)
            deferred.resolve(n[data.name])
          },
          function (resp) {
            deferred.reject('Cannot connect to peer to autoconfigure the network')
          }
        )
      }
      return deferred.promise
    }

    function switchNetwork (newnetwork, reload) {
      var n
      if (!newnetwork) { // perform round robin
        n = storageService.getGlobal('networks')
        var keys = Object.keys(n)
        var i = keys.indexOf(storageService.getContext()) + 1
        if (i === keys.length) {
          i = 0
        }
        storageService.switchContext(keys[i])
        return window.location.reload()
      }
      storageService.switchContext(newnetwork)
      n = storageService.getGlobal('networks')
      if (!n) {
        n = {
          testnet: {
            nethash: 'ea28576ec4ddda11e09b8e1b3cfbe41485da89fcd6d776e409b688004cdbe036',
            peerseed: 'http://51.75.27.22:4001',
            token: 'TSKELPY',
            symbol: 'TƧ',
            version: 0x52,
            slip44: 1, // all coin testnet
            explorer: 'http://texplorer.skelpy.co',
            background: 'url(assets/images/images/SKP_background3.jpg) no-repeat ',
            theme: 'default',
            themeDark: false
          }
        }
        storageService.setGlobal('networks', n)
      }
      if (reload) {
        return window.location.reload()
      }
      return n[newnetwork]
    }

    function getNetwork () {
      return network
    }

    function getNetworks () {
      return storageService.getGlobal('networks')
    }
    function getCurrency() {
      return storageService.get('currency')
    }
    function getPrice () {
      let failedTicker = () => {
        let lastPrice = storageService.get('lastPrice')

        if (typeof lastPrice === 'undefined') {
          peer.market = { price: { btc: '0.0' } }
          return
        }

        peer.market = lastPrice.market
        peer.market.lastUpdate = lastPrice.date
        peer.market.isOffline = true
      }

      if (!network.cmcTicker && network.token !== 'SKP') {
        failedTicker()
        return
      }
      var currencyName = getCurrency()  
      $http.get('https://api.coinmarketcap.com/v1/ticker/' + (network.cmcTicker || 'Skelpy'), { timeout: 2000 })
      .then(function (res) {
        if (res.data[0] && res.data[0].price_btc) {
          res.data[0].price_btc = convertToSatoshi(res.data[0].price_btc) // store BTC price in satoshi
        }

        peer.market = res.data[0]
        peer = updatePeerWithCurrencies(peer)
        storageService.set('lastPrice', { market: peer.market, date: new Date() })
      }, failedTicker)
      .catch(failedTicker)
      $timeout(function () {
        getPrice()
      }, 5 * 60000)
    }

    function listenNetworkHeight () {
      $http.get(peer.ip + '/api/blocks/getheight', { timeout: 5000 }).then(function (resp) {
        timeService.getTimestamp().then(
          function (timestamp) {
            peer.lastConnection = timestamp
            if (resp.data && resp.data.success) {
              if (peer.height === resp.data.height) {
                peer.isConnected = false
                peer.error = 'Node is experiencing sychronisation issues'
                connection.notify(peer)
                pickRandomPeer()
              } else {
                peer.height = resp.data.height
                peer.isConnected = true
                connection.notify(peer)
              }
            } else {
              peer.isConnected = false
              peer.error = resp.statusText || 'Peer Timeout after 5s'
              connection.notify(peer)
            }
          }
        )
      })
      $timeout(function () {
        listenNetworkHeight()
      }, 60000)
    }

    function getFromPeer (api) {
      var deferred = $q.defer()
      peer.lastConnection = new Date()
      $http({
        url: peer.ip + api,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'os': 'skelpy-desktop',
          'version': clientVersion,
          'port': 1,
          'nethash': network.nethash
        },
        timeout: 5000
      }).then(
        function (resp) {
          deferred.resolve(resp.data)
          peer.isConnected = true
          peer.delay = new Date().getTime() - peer.lastConnection.getTime()
          connection.notify(peer)
        },
        function (resp) {
          deferred.reject('Peer disconnected')
          peer.isConnected = false
          peer.error = resp.statusText || 'Peer Timeout after 5s'
          connection.notify(peer)
        }
      )

      return deferred.promise
    }

    function broadcastTransaction (transaction, max) {
      var peers = storageService.get('peers')
      if (!peers) {
        return
      }
      if (!max) {
        max = 10
      }
      for (var i = 0; i < max; i++) {
        if (i < peers.length) {
          postTransaction(transaction, 'http://' + peers[i].ip + ':' + peers[i].port)
        }
      }
    }

    function postTransaction (transaction, ip) {
      var deferred = $q.defer()
      var peerip = ip
      if (!peerip) {
        peerip = peer.ip
      }
      $http({
        url: peerip + '/peer/transactions',
        data: { transactions: [transaction] },
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'os': 'skelpy-desktop',
          'version': clientVersion,
          'port': 1,
          'nethash': network.nethash
        }
      }).then(function (resp) {
        if (resp.data.success) {
          // we make sure that tx is well broadcasted
          if (!ip) {
            broadcastTransaction(transaction)
          }
          deferred.resolve(transaction)
        } else {
          deferred.reject(resp.data)
        }
      })
      return deferred.promise
    }

    function pickRandomPeer () {
      if (!network.forcepeer) {
        getFromPeer('/api/peers')
          .then((response) => {
            if (response.success) {
              getFromPeer('/api/peers/version').then(function (versionResponse) {
                if (versionResponse.success) {
                  let peers = response.peers.filter(function (peer) {
                    return peer.status === 'OK' && peer.version === versionResponse.version
                  })
                  storageService.set('peers', peers)
                  findGoodPeer(peers, 0)
                } else {
                  findGoodPeer(storageService.get('peers'), 0)
                }
              })
            } else {
              findGoodPeer(storageService.get('peers'), 0)
            }
          }, () => findGoodPeer(storageService.get('peers'), 0))
      }
    }

    function findGoodPeer (peers, index) {
      if (index > peers.length - 1) {
        // peer.ip=network.peerseed
        return
      }
      if (index === 0) {
        peers = peers.sort(function (a, b) {
          return b.height - a.height || a.delay - b.delay
        })
      }
      peer.ip = 'http://' + peers[index].ip + ':' + peers[index].port
      getFromPeer('/api/blocks/getheight')
        .then((response) => {
          if (response.success && response.height < peer.height) {
            findGoodPeer(peers, index + 1)
          } else {
            peer.height = response.height
          }
        }, () => findGoodPeer(peers, index + 1))
    }

    function getPeer () {
      return peer
    }

    function getConnection () {
      return connection.promise
    }

    function getLatestClientVersion () {
      var deferred = $q.defer()
      var url = 'https://api.github.com/repos/SkelpyCoin/skelpy-desktop/releases/latest'
      $http.get(url, { timeout: 5000 })
        .then(function (res) {
          deferred.resolve(res.data.tag_name)
        }, function (e) {
          // deferred.reject(gettextCatalog.getString("Cannot get latest version"))
        })
      return deferred.promise
    }

    // Returns the BTC value in satoshi
    function convertToSatoshi (val) {
      return Number(val).toFixed(8)
    }

    // Updates peer with all currency values relative to the USD price.
    function updatePeerWithCurrencies (peer) {
      $http.get('https://bit.skelpy.co/wallet/utilities/exchangerates', {timeout: 2000}).then(function (result) {
        const SKP_BTC = result.data.rates['SKP'].rate_btc
        const USD_BTC = result.data.rates['USD'].rate_btc
        const USD_PRICE = Number((SKP_BTC/USD_BTC).toFixed(2))
        var currencies = ['aud', 'brl', 'cad', 'chf', 'cny', 'eur', 'gbp', 'hkd', 'idr', 'inr', 'jpy', 'krw', 'mxn', 'rub']
        var prices = {}
        currencies.forEach(function (currency) {
        let inBTC = result.data.rates[currency.toUpperCase()].rate_btc

        if (inBTC == "BTC"){
          prices[currency] = inBTC.toFixed(8)
        }
        else {
          prices[currency] = (SKP_BTC / result.data.rates[currency.toUpperCase()].rate_btc).toFixed(2)
        }
        })
        prices['btc'] = SKP_BTC
        prices['usd'] = USD_PRICE
        peer.market.price = prices
        storageService.setGlobal('peerCurrencies', prices)
      })

      return peer
    }

    listenNetworkHeight()
    getPrice()
    pickRandomPeer()

    return {
      switchNetwork: switchNetwork,
      setNetwork: setNetwork,
      createNetwork: createNetwork,
      removeNetwork: removeNetwork,
      getNetwork: getNetwork,
      getNetworks: getNetworks,
      getCurrency: getCurrency,
      getPeer: getPeer,
      getConnection: getConnection,
      getFromPeer: getFromPeer,
      postTransaction: postTransaction,
      broadcastTransaction: broadcastTransaction,
      pickRandomPeer: pickRandomPeer,
      getLatestClientVersion: getLatestClientVersion,
      getPrice: getPrice
    }
  }
})()

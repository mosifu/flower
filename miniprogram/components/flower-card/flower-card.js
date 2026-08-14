// 花卡组件：水彩卡面 + 稀有度边框 + 收集/未收集状态，点击跳详情
Component({
  properties: {
    species: {
      type: Object,
      value: {}
    },
    collected: {
      type: Boolean,
      value: false
    },
    meetCount: {
      type: Number,
      value: 0
    },
    compact: {
      type: Boolean,
      value: false
    }
  },

  data: {
    rarityClass: 'rarity-common',
    rarityLabel: '常见',
    // 花期拼接文案（WXML 不支持数组 join，在 JS 侧拼好）
    bloomText: ''
  },

  observers: {
    // 稀有度/花期变化时同步边框 class、标签文案与花期文本
    'species': function (s) {
      if (!s) return;
      const map = {
        common: { cls: 'rarity-common', label: '常见' },
        rare: { cls: 'rarity-rare', label: '少见' },
        epic: { cls: 'rarity-epic', label: '珍稀' },
        legendary: { cls: 'rarity-legendary', label: '传说' }
      };
      const info = map[s.rarity] || map.common;
      this.setData({
        rarityClass: info.cls,
        rarityLabel: info.label,
        bloomText: (s.bloomSeasons || []).join(' · ')
      });
    }
  },

  methods: {
    onTap() {
      /**
       * 点击花卡：跳转对应花种详情页
       * @returns {void}
       */
      // 点击花卡跳转对应花种详情页
      const s = this.data.species;
      if (!s || !s._id) return;
      wx.navigateTo({
        url: `/pages/detail/detail?speciesId=${s._id}`
      });
    }
  }
});

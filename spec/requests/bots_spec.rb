require 'rails_helper'

RSpec.describe "Bots", type: :request do

  let(:user) { last_or_create(:user) }
  before { sign_in_as(user) }

  describe "GET /bots" do
    it "returns http success" do
      get bots_path
      expect(response).to be_success_with_view_check('index')
    end
  end

  describe "GET /bots/:id" do
    let(:bot_record) { create(:bot, user: user) }

    it "returns http success" do
      get bot_path(bot_record)
      expect(response).to be_success_with_view_check('show')
    end
  end

  describe "GET /bots/new" do
    it "returns http success" do
      get new_bot_path
      expect(response).to be_success_with_view_check('new')
    end
  end

  describe "GET /bots/:id/edit" do
    let(:bot_record) { create(:bot, user: user) }

    it "returns http success" do
      get edit_bot_path(bot_record)
      expect(response).to be_success_with_view_check('edit')
    end
  end

  describe "POST /bots" do
    it "creates a new bot" do
      post bots_path, params: { bot: attributes_for(:bot) }
      expect(response).to be_success_with_view_check
    end
  end


  describe "PATCH /bots/:id" do
    let(:bot_record) { create(:bot, user: user) }

    it "updates the bot" do
      patch bot_path(bot_record), params: { bot: attributes_for(:bot) }
      expect(response).to be_success_with_view_check
    end
  end
end

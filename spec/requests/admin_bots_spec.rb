require 'rails_helper'

RSpec.describe "Admin::Bots", type: :request do
  before { admin_sign_in_as(create(:administrator)) }

  describe "GET /admin/bots" do
    it "returns http success" do
      get admin_bots_path
      expect(response).to be_success_with_view_check('index')
    end
  end

end

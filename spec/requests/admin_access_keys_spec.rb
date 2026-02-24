require 'rails_helper'

RSpec.describe "Admin::AccessKeys", type: :request do
  before { admin_sign_in_as(create(:administrator)) }

  describe "GET /admin/access_keys" do
    it "returns http success" do
      get admin_access_keys_path
      expect(response).to be_success_with_view_check('index')
    end
  end

end

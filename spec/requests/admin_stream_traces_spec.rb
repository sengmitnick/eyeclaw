require 'rails_helper'

RSpec.describe "Admin::StreamTraces", type: :request do
  before { admin_sign_in_as(create(:administrator)) }

  describe "GET /admin/stream_traces" do
    it "returns http success" do
      get admin_stream_traces_path
      expect(response).to be_success_with_view_check('index')
    end
  end

end
